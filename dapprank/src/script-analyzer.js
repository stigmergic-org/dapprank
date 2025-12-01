import { GoogleGenAI } from "@google/genai"
import * as parser from '@babel/parser'
import traverseDefault from '@babel/traverse'
import crypto from 'crypto'
import { getFileContent } from './ipfs-utils.js'
import { SYSTEM_PROMPT_TEMPLATE } from './constants.js'
import { logger } from './logger.js'

const promptHash = createPromptHash(SYSTEM_PROMPT_TEMPLATE);

const traverse = traverseDefault.default

/**
 * Detect window.ethereum occurrences in JavaScript code
 * @param {string} scriptText - The JavaScript content to analyze
 * @returns {number} Number of occurrences found, 0 if none
 */
export function detectWindowEthereum(scriptText) {
    if (!scriptText || scriptText.trim().length < 20) {
        return 0;
    }
    
    const windowEthereumPattern = /window\.ethereum/g;
    const matches = scriptText.match(windowEthereumPattern);
    
    return matches ? matches.length : 0;
}

/**
 * Splits a JS script into two chunks by finding an AST node near the middle.
 * Falls back to char-based split if parsing fails.
 * @param {string} scriptText - The JS code to split.
 * @returns {[string, string]} - Two chunks of code.
 */
export function splitScriptIntoChunks(scriptText) {
    let splitIndex = Math.floor(scriptText.length / 2); // default fallback

    try {
        const ast = parser.parse(scriptText, {
            sourceType: 'module',
            allowReturnOutsideFunction: true,
            errorRecovery: true
        });

        const codeLength = scriptText.length;
        let closestNode = null;
        let closestDist = Infinity;

        traverse(ast, {
            enter(path) {
                const { start } = path.node;
                if (typeof start !== 'number') return; // skip nodes without positions

                const dist = Math.abs(start - codeLength / 2);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestNode = path.node;
                }
            }
        });

        if (closestNode) {
            splitIndex = closestNode.start;
        }
    } catch (err) {
        console.warn('AST parsing failed — falling back to char-based split.', err);
    }

    // Perform the split
    const chunkA = scriptText.slice(0, splitIndex);
    const chunkB = scriptText.slice(splitIndex);

    return [chunkA, chunkB];
}

async function geminiAnalysis(scriptText, filePath) {
    // Load API key from environment variable
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error('GOOGLE_API_KEY environment variable not set');
    }
    
    // Initialize the Google Generative AI client
    const ai = new GoogleGenAI({ apiKey });
    
    // Use the system prompt template defined at the top level
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE;
    
    // Define the response schema structure
    const responseSchema = {
        type: "object",
        required: ["libraries", "networking", "urls"],
        properties: {
            libraries: {
                type: "array",
                items: {
                    type: "object",
                    required: ["name", "motivation"],
                    properties: {
                        name: { type: "string" },
                        motivation: { type: "string" }
                    }
                }
            },
            networking: {
                type: "array",
                items: {
                    type: "object",
                    required: ["method", "urls", "type", "motivation"],
                    properties: {
                        method: { type: "string" },
                        urls: { 
                            type: "array",
                            items: { type: "string" }
                        },
                        library: { type: "string" },
                        type: { 
                            type: "string",
                            enum: ["rpc", "bundler", "auxiliary", "self"]
                        },
                        motivation: { type: "string" }
                    }
                }
            },
            fallbacks: {
                type: "array",
                items: {
                    type: "object",
                    required: ["type", "motivation"],
                    properties: {
                        type: { 
                            type: "string",
                            enum: ["rpc", "bundler", "dservice-self", "dservice-external"]
                        },
                        motivation: { type: "string" }
                    }
                }
            }
        }
    };

    let retries = 3;
    let lastError = null;

    while (retries > 0) {
        try {
            // Query the Gemini model with structured output
            const response = await ai.models.generateContent({
                // model: "gemini-2.5-pro-exp-03-25", // free model
                model: "gemini-2.5-pro-preview-03-25",
                contents: [
                    {
                        role: "user",
                        parts: [
                            { text: systemPrompt },
                            { text: `File: ${filePath}\n\nCode:\n\`\`\`javascript\n${scriptText}\n\`\`\`` }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                },
                response_mime_type: "application/json",
                response_schema: responseSchema
            });
            
            logger.debug(`Received response from Gemini for ${filePath}`);

            if (response.candidates[0].content.parts.length > 1) {
                logger.debug('Multiple response parts found:', response.candidates[0].content.parts);
                throw new Error('Multiple parts found in response, not sure how to proceed');
            }

            const textContent = response.candidates[0].content.parts[0].text;

            try {
                // First try to parse as direct JSON
                const analysis = JSON.parse(textContent);
                return {
                    libraries: analysis.libraries,
                    networking: analysis.networking,
                    fallbacks: analysis.fallbacks
                };
            } catch (jsonError) {
                // If direct JSON parse fails, try markdown extraction
                const markdownMatch = textContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
                if (!markdownMatch) {
                    throw new Error('Could not find JSON in markdown response');
                }
                
                const analysis = JSON.parse(markdownMatch[1]);
                return {
                    libraries: analysis.libraries,
                    networking: analysis.networking,
                    fallbacks: analysis.fallbacks
                };
            }
        } catch (error) {
            lastError = error;
            retries--;
            
            if (retries > 0) {
                if (error.message && error.message.includes('token count') && error.message.includes('exceeds')) {
                    break;
                }
                logger.warn(`Error parsing Gemini response for ${filePath}, retrying... (${retries} attempts left)`);
                // Add a small delay between retries
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            
            throw lastError;
        }
    }

    throw lastError;
}

async function geminiAnalysisWithChunking(scriptText, filePath) {
    try {
        return await geminiAnalysis(scriptText, filePath);
    } catch (error) {
        // Handle rate limit error (429)
        if (error.message && error.message.includes('status: 429')) {
            logger.warn('Rate limit exceeded, waiting for 1 minute before retrying...');
            await new Promise(resolve => setTimeout(resolve, 60000)); // Wait for 1 minute
            return await geminiAnalysisWithChunking(scriptText, filePath); // Retry recursively
        }
        
        // Handle token count exceeded error
        if (error.message && error.message.includes('token count') && error.message.includes('exceeds')) {
            logger.warn('Token limit exceeded, attempting to chunk the code...');
            const chunks = await splitScriptIntoChunks(scriptText);
            logger.info(`Split script into ${chunks.length} chunks`);

            const results = [];
            for (const chunk of chunks) {
                const result = await geminiAnalysisWithChunking(chunk, filePath);
                results.push(result);
            }

            const mergedResults = results.reduce((acc, curr) => {
                if (curr.libraries) {
                    acc.libraries = [...acc.libraries, ...curr.libraries];
                }
                if (curr.networking) {
                    acc.networking = [...acc.networking, ...curr.networking];
                }
                if (curr.fallbacks) {
                    acc.fallbacks = [...acc.fallbacks, ...curr.fallbacks];
                }
                return acc;
            }, { libraries: [], networking: [], fallbacks: [] });
            
            return mergedResults;
        }
        throw error;
    }
}

export async function analyzeScript(kubo, cache, file) {
    if (file.inlineScripts && file.inlineScripts.length > 0) {
        // Handle multiple inline scripts by concatenating them
        // Wrap each script in its own script tags for clarity
        const concatenatedScripts = file.inlineScripts
            .map((script, index) => `// HTML Inline script ${index + 1}\n${script}`)
            .join('\n\n');
        // Create a virtual file path for inline scripts
        const virtualPath = `${file.path}#inline-scripts`;
        
        return await analyzeIndividualScript(virtualPath, concatenatedScripts, cache, file.cid);
    } else if (file.path.endsWith('.js')) {
        const scriptText = await getFileContent(kubo, file.cid);
        return await analyzeIndividualScript(file.path, scriptText, cache, file.cid);
    }
    return {};
}

/**
 * Analyzes a single JavaScript file or inline script
 * @param {string} filePath - Path or identifier for the script
 * @param {string} scriptText - The JavaScript content to analyze
 * @param {CacheManager} cache - Cache manager instance
 * @param {string} fileCid - The CID of the file for caching purposes
 * @returns {Object} Analysis results with networkingPurity and ethereum data
 * @throws {Error} If AI analysis fails
 */
export async function analyzeIndividualScript(filePath, scriptText, cache, fileCid) {
    logger.debug(`Analyzing script: ${filePath}`);
    
    // Initialize empty results
    const result = {
        libraries: [],
        networking: [],
        fallbacks: []
    };
    
    try {
        // Check if we already have an analysis for this script content and prompt
        const cachedResult = await cache.getEntry(promptHash, fileCid);
        if (cachedResult) {
            logger.debug(`Using cached analysis for ${filePath}`);
            
            // Initialize the returning result object
            const cachedAnalysis = {
                libraries: cachedResult.libraries || [],
                networking: cachedResult.networking || [],
                fallbacks: cachedResult.fallbacks || [],
            };
            return cachedAnalysis;
        }
        
        const analysis = await geminiAnalysisWithChunking(scriptText, filePath);

        
        if (!analysis) {
            throw new Error('No valid analysis data extracted from response');
        }
        
        // Process the results 
        if (analysis.networking && analysis.networking.length > 0) {
            result.networking = analysis.networking;
        }
        
        if (analysis.libraries && analysis.libraries.length > 0) {
            result.libraries = analysis.libraries;
        }
        
        if (analysis.fallbacks && analysis.fallbacks.length > 0) {
            result.fallbacks = analysis.fallbacks;
        }
        
        // Store in cache for future use - use file CID for caching
        await cache.setEntry(promptHash, fileCid, {
            libraries: result.libraries,
            networking: result.networking,
            fallbacks: result.fallbacks
        });
        
        logger.debug(`Successfully analyzed ${filePath}`);
    } catch (aiError) {
        logger.error(`Error in script analysis for ${filePath}:`, aiError);
        throw aiError; // Re-throw the error to fail the entire process
    }
    
    return result;
}

// Cache utility functions
function createPromptHash(prompt) {
    return crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 8);
}
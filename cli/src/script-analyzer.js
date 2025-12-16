import { GoogleGenAI } from "@google/genai"
import * as parser from '@babel/parser'
import traverseDefault from '@babel/traverse'
import crypto from 'crypto'
import { getFileContent } from './ipfs-utils.js'
import { SYSTEM_PROMPT_TEMPLATE, AI_REQUESTS_PER_MINUTE } from './constants.js'
import { logger } from './logger.js'
import { normalizeUrl, stripApiKey } from './url-validator.js'
import { deduplicateNetworking, deduplicateFallbacks } from './deduplication.js'
import { getRateLimiter } from './rate-limiter.js'

const promptHash = createPromptHash(SYSTEM_PROMPT_TEMPLATE);

const traverse = traverseDefault.default

/**
 * Detect window.ethereum usage in JavaScript code
 * @param {string} scriptText - The JavaScript content to analyze
 * @returns {boolean} Whether window.ethereum is used
 */
export function detectWindowEthereum(scriptText) {
    if (!scriptText || scriptText.trim().length < 20) {
        return false;
    }
    
    const windowEthereumPattern = /window\.ethereum/;
    return windowEthereumPattern.test(scriptText);
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
        logger.warn(`AST parsing failed — falling back to char-based split: ${err.message}`);
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
        required: ["networking", "windowEthereum"],
        properties: {
            windowEthereum: {
                type: "boolean"
            },
            networking: {
                type: "array",
                items: {
                    type: "object",
                    required: ["method", "urls", "type", "motivation"],
                    properties: {
                        method: { type: "string" },
                        httpMethod: { 
                            type: "string",
                            enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "UNKNOWN"]
                        },
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
                            enum: ["rpc", "bundler", "dservice-external"]
                        },
                        motivation: { type: "string" }
                    }
                }
            },
            dynamicResourceLoading: {
                type: "array",
                items: {
                    type: "object",
                    required: ["method", "urls", "type", "motivation"],
                    properties: {
                        method: {
                            type: "string",
                            enum: ["dynamic-import", "script-injection", "link-injection", "image-tracking", "iframe-injection", "video-injection", "audio-injection"]
                        },
                        urls: {
                            type: "array",
                            items: { type: "string" }
                        },
                        type: {
                            type: "string",
                            enum: ["script", "stylesheet", "media", "other"]
                        },
                        motivation: { type: "string" }
                    }
                }
            }
        }
    };

    const MAX_RETRIES = 3; // For non-rate-limit errors
    let retries = MAX_RETRIES;
    let rateLimitAttempt = 0; // Separate counter for rate limit retries (unlimited)
    let lastError = null;

    while (true) {
        try {
            // Wait for rate limiter before making API call
            const rateLimiter = getRateLimiter(AI_REQUESTS_PER_MINUTE);
            await rateLimiter.waitForSlot();
            
            // Query the Gemini model with structured output
            const response = await ai.models.generateContent({
                model: "gemini-2.5-pro",
                requestOptions: { apiClient: "rest" },
                thinkingConfig: { 
                  includeThoughts: true,
                  thinkingBudget: 8192
                },
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
                    windowEthereum: analysis.windowEthereum || false,
                    networking: analysis.networking || [],
                    fallbacks: analysis.fallbacks || [],
                    dynamicResourceLoading: analysis.dynamicResourceLoading || []
                };
            } catch (jsonError) {
                // If direct JSON parse fails, try markdown extraction
                const markdownMatch = textContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
                if (!markdownMatch) {
                    throw new Error('Could not find JSON in markdown response');
                }
                
                const analysis = JSON.parse(markdownMatch[1]);
                return {
                    windowEthereum: analysis.windowEthereum || false,
                    networking: analysis.networking || [],
                    fallbacks: analysis.fallbacks || [],
                    dynamicResourceLoading: analysis.dynamicResourceLoading || []
                };
            }
        } catch (error) {
            lastError = error;
            
            // Check for quota exhaustion (don't retry)
            if (error.message && error.message.includes('Quota exceeded')) {
                logger.error(`Quota exceeded for ${filePath}: ${error.message}`);
                throw error;
            }
            
            // Check for token count exceeded (don't retry, will chunk instead)
            if (error.message && error.message.includes('token count') && error.message.includes('exceeds')) {
                throw error;
            }
            
            // Check for rate limit (429) - retry indefinitely with exponential backoff
            if (error.message && error.message.includes('status: 429')) {
                rateLimitAttempt++;
                
                // Exponential backoff with cap: min(2^attempt * 10s, 2 hours)
                // Attempt 1: 20s, Attempt 2: 40s, Attempt 3: 80s, Attempt 4: 160s, Attempt 5: 320s, 
                // Attempt 6: 640s, Attempt 7: 1280s, Attempt 8: 2560s, Attempt 9: 5120s, Attempt 10+: 7200s (2 hours)
                const baseDelay = 10000;
                const maxDelay = 7200000; // Cap at 2 hours
                const backoffDelay = Math.pow(2, rateLimitAttempt) * baseDelay;
                
                // If we've hit the max delay cap, it means we're consistently being rate limited
                // Exit the program to avoid waiting indefinitely
                if (backoffDelay >= maxDelay) {
                    logger.error(`Rate limit backoff has reached maximum (2 hours) for ${filePath}`);
                    logger.error('This indicates persistent rate limiting. Please check your API quota and try again later.');
                    process.exit(1);
                }
                
                const backoffSeconds = Math.ceil(backoffDelay / 1000);
                
                logger.warn(`Rate limit hit for ${filePath} (rate limit attempt ${rateLimitAttempt}), waiting ${backoffSeconds}s...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                
                // Notify rate limiter to slow down globally
                const rateLimiter = getRateLimiter(AI_REQUESTS_PER_MINUTE);
                rateLimiter.onRateLimitError();
                
                continue;
            }
            
            // For other errors, retry with short delay
            retries--;
            if (retries > 0) {
                const attempt = MAX_RETRIES - retries;
                logger.warn(`Error analyzing ${filePath} (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
                logger.debug(`Error details: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            
            logger.error(`Failed to analyze ${filePath} after ${MAX_RETRIES} attempts`);
            logger.debug(`Final error: ${error.message}`);
            throw lastError;
        }
    }
}

async function geminiAnalysisWithChunking(scriptText, filePath) {
    try {
        return await geminiAnalysis(scriptText, filePath);
    } catch (error) {
        // Handle token count exceeded error by chunking
        if (error.message && error.message.includes('token count') && error.message.includes('exceeds')) {
            logger.warn('  ⚠️  Token limit exceeded, splitting into chunks...');
            const chunks = await splitScriptIntoChunks(scriptText);
            logger.info(`  📦 Analyzing ${chunks.length} chunks separately...`);

            const results = [];
            for (let i = 0; i < chunks.length; i++) {
                logger.info(`  🤖 Analyzing chunk ${i + 1}/${chunks.length}...`);
                const result = await geminiAnalysisWithChunking(chunks[i], filePath);
                results.push(result);
            }

            // Merge and deduplicate results from all chunks
            const allNetworking = results.reduce((acc, curr) => [...acc, ...(curr.networking || [])], []);
            const allFallbacks = results.reduce((acc, curr) => [...acc, ...(curr.fallbacks || [])], []);
            const allDynamicLoading = results.reduce((acc, curr) => [...acc, ...(curr.dynamicResourceLoading || [])], []);
            // windowEthereum: true if ANY chunk detected it
            const windowEthereum = results.some(curr => curr.windowEthereum);
            
            const mergedResults = {
                windowEthereum,
                networking: deduplicateNetworking(allNetworking),
                fallbacks: deduplicateFallbacks(allFallbacks),
                dynamicResourceLoading: deduplicateNetworking(allDynamicLoading) // Use same logic as networking
            };
            
            logger.debug('Merged chunked results', {
                windowEthereum: mergedResults.windowEthereum,
                networking: mergedResults.networking.length,
                fallbacks: mergedResults.fallbacks.length,
                dynamicResourceLoading: mergedResults.dynamicResourceLoading.length
            });
            
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
    const startTime = Date.now();
    logger.debug(`Analyzing script: ${filePath}`);
    
    // Initialize empty results
    const result = {
        windowEthereum: false,
        networking: [],
        fallbacks: [],
        dynamicResourceLoading: []
    };
    
    let cacheHit = false;
    
    try {
        // Check if we already have an analysis for this script content and prompt
        const cachedResult = await cache.getEntry(promptHash, fileCid);
        if (cachedResult) {
            cacheHit = true;
            logger.debug(`✓ Using cached analysis for ${filePath}`);
            
            // Return cached result
            const cachedAnalysis = {
                windowEthereum: cachedResult.windowEthereum || false,
                networking: cachedResult.networking || [],
                fallbacks: cachedResult.fallbacks || [],
                dynamicResourceLoading: cachedResult.dynamicResourceLoading || []
            };
            
            // Log metrics
            logger.debug('Analysis metrics', {
                file: filePath,
                cacheHit: true,
                durationMs: Date.now() - startTime
            });
            
            return cachedAnalysis;
        }
        
        logger.info(`  🤖 Running AI analysis...`);
        const analysis = await geminiAnalysisWithChunking(scriptText, filePath);
        
        if (!analysis) {
            throw new Error('No valid analysis data extracted from response');
        }
        
        // Process window.ethereum detection
        result.windowEthereum = analysis.windowEthereum || false;
        
        // Process networking results
        if (analysis.networking && analysis.networking.length > 0) {
            result.networking = analysis.networking.map(item => ({
                ...item,
                urls: (item.urls || []).map(normalizeUrl)
            }));
        }
        
        // Process fallbacks
        if (analysis.fallbacks && analysis.fallbacks.length > 0) {
            result.fallbacks = analysis.fallbacks;
        }
        
        // Process dynamic resource loading
        if (analysis.dynamicResourceLoading && analysis.dynamicResourceLoading.length > 0) {
            result.dynamicResourceLoading = analysis.dynamicResourceLoading.map(item => ({
                ...item,
                urls: (item.urls || []).map(normalizeUrl)
            }));
        }
        
        // Deduplicate within single file results
        result.networking = deduplicateNetworking(result.networking);
        result.fallbacks = deduplicateFallbacks(result.fallbacks);
        result.dynamicResourceLoading = deduplicateNetworking(result.dynamicResourceLoading); // Use same logic
        
        // Store in cache for future use - use file CID for caching
        await cache.setEntry(promptHash, fileCid, {
            windowEthereum: result.windowEthereum,
            networking: result.networking,
            fallbacks: result.fallbacks,
            dynamicResourceLoading: result.dynamicResourceLoading
        });
        
        // Log metrics
        const endTime = Date.now();
        logger.debug('Analysis metrics', {
            file: filePath,
            cacheHit: false,
            durationMs: endTime - startTime,
            windowEthereum: result.windowEthereum,
            networkingCount: result.networking.length,
            fallbackCount: result.fallbacks.length,
            dynamicLoadingCount: result.dynamicResourceLoading.length
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

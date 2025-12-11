import { getFilesFromCID, detectMimeType } from './ipfs-utils.js'
import { analyzeHTML, getFavicon } from './html-analyzer.js'
import { analyzeIndividualScript } from './script-analyzer.js'
import { ANALYSIS_VERSION } from './constants.js'
import { logger } from './logger.js'

// Helper function to add data to report if not empty
function addToReportIfNotEmpty(report, analysis, filePath) {
    if (analysis && analysis.length > 0) {
        report.push({ file: filePath, occurences: analysis });
    }
}

// Load JavaScript file
async function loadJavaScriptFile(kubo, cid, filePath) {
    logger.debug(`Loading JavaScript file: ${filePath}`);
    const content = await getFileContent(kubo, cid);
    return content
}

// Function to extract the content of a file as a string
async function getFileContent(kubo, cid) {
    try {
        const chunks = [];
        for await (const chunk of kubo.cat(cid)) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf-8');
    } catch (error) {
        logger.error(`Error getting file content: ${error.message}`);
        return null;
    }
}

// Generate the main analysis report
export async function generateReport(kubo, rootCID, blockNumber = null) {
    try {
        // First, detect the MIME type of the root
        const rootMimeType = await detectMimeType(kubo, rootCID);
        logger.debug(`Root MIME type: ${rootMimeType}`);
        
        // Get all files in the IPFS directory
        const files = await getFilesFromCID(kubo, rootCID);
        logger.info(`Found ${files.length} files to analyze`);
        
        // Initialize the report structure
        const report = {
            version: ANALYSIS_VERSION,
            contentHash: rootCID,
            timestamp: Math.floor(Date.now() / 1000),
            blockNumber: blockNumber ? Number(blockNumber) : null,
            rootMimeType: rootMimeType,
            totalSize: 0,
            favicon: '',
            title: '',
            distributionPurity: {
                externalScripts: [],
                externalMedia: [],
            },
            networkingPurity: [],
            urls: [],
            ethereum: [], // Field to store unique files that access window.ethereum
            fallbacks: [] // New field to store dappspec fallback support
        };
        
        let faviconInfo = null;
        let indexHtmlContent = null;

        // Process all files
        for (const file of files) {
            report.totalSize += file.size;

            if (file.path.includes('.well-known/source.git')) continue
            
            const fileMimeType = await detectMimeType(kubo, file.cid);
            logger.debug(`File: ${file.path}, Detected MIME type: ${fileMimeType}`);
            
            if (fileMimeType.includes('html')) {
                const { metadata, distributionPurity, scriptContents } = await analyzeHTML(kubo, file.cid, file.path);
                
                // If this is index.html, extract title and favicon
                if (file.path.toLowerCase() === 'index.html' || 
                    (file.path === '' && fileMimeType.includes('html'))) {
                    report.title = metadata?.title || '';
                    indexHtmlContent = await getFileContent(kubo, file.cid);

                    // Extract favicon if we have index.html content
                    if (indexHtmlContent) {
                        faviconInfo = await getFavicon(kubo, files);
                        report.favicon = faviconInfo.path;
                    }
                }

                // Process inline scripts from HTML
                if (scriptContents && scriptContents.length > 0) {
                    logger.debug(`Found ${scriptContents.length} inline scripts in ${file.path}`);
                    
                    // Process each inline script individually
                    for (let i = 0; i < scriptContents.length; i++) {
                        const scriptText = scriptContents[i];
                        if (scriptText && scriptText.trim().length >= 20) {
                            const inlineScriptPath = `${file.path}#inline-script-${i+1}`;
                            logger.debug(`Analyzing inline script #${i+1} from ${file.path} (${scriptText.length} bytes)`);
                            
                            // Analyze this individual inline script
                            const scriptAnalysis = await analyzeIndividualScript(inlineScriptPath, scriptText);
                            
                            // Add networking purity findings to the report
                            addToReportIfNotEmpty(report.networkingPurity, scriptAnalysis.networking, inlineScriptPath);
                            // Add Ethereum findings to the report
                            addToReportIfNotEmpty(report.ethereum, scriptAnalysis.ethereum, inlineScriptPath);
                            // Add urls findings to the report
                            addToReportIfNotEmpty(report.urls, scriptAnalysis.urls, inlineScriptPath);
                            // Add dappspec fallback findings to the report
                            addToReportIfNotEmpty(report.fallbacks, scriptAnalysis.fallbacks, inlineScriptPath);
                        }
                    }
                }
                
                addToReportIfNotEmpty(report.distributionPurity.externalScripts, distributionPurity?.externalScripts, file.path);
                addToReportIfNotEmpty(report.distributionPurity.externalMedia, distributionPurity?.externalMedia, file.path);
            } 
            else if (fileMimeType.includes('javascript') || file.path.endsWith('.js')) {
                // Load and analyze JavaScript file
                const content = await loadJavaScriptFile(kubo, file.cid, file.path);
                if (content && content.trim().length >= 20) {
                    logger.debug(`Analyzing JavaScript file: ${file.path} (${content.length} bytes)`);
                    
                    // Analyze this individual JS file
                    const scriptAnalysis = await analyzeIndividualScript(file.path, content);
                    
                    // Add networking findings to the report
                    addToReportIfNotEmpty(report.networkingPurity, scriptAnalysis.networking, file.path);
                    // Add Ethereum findings to the report
                    addToReportIfNotEmpty(report.ethereum, scriptAnalysis.ethereum, file.path);
                    // Add urls findings to the report
                    addToReportIfNotEmpty(report.urls, scriptAnalysis.urls, file.path);
                    // Add dappspec fallback findings to the report
                    addToReportIfNotEmpty(report.fallbacks, scriptAnalysis.fallbacks, file.path);
                }
            }
        }

        logger.info(`Analysis complete. Total size: ${(report.totalSize / 1024 / 1024).toFixed(2)} MB`);
        return { report, faviconInfo };
    } catch (error) {
        logger.error(`Error generating report: ${error.message}`);
        logger.error(error);
        throw error;
    }
}

// Save report to disk and create necessary directories and symlinks
export async function saveReport(report, ensName, blockNumber, storage, faviconInfo) {
    // Save the report to archive directory
    const reportPath = `/archive/${ensName}/${blockNumber}/report.json`
    await storage.writeFile(reportPath, JSON.stringify(report, null, 2))
    logger.info('Report saved to', reportPath)

    // Create metadata.json in archive root directory if it doesn't exist
    const metadataArchivePath = `/archive/${ensName}/metadata.json`
    if (!(await storage.exists(metadataArchivePath))) {
        // metadata.json doesn't exist, create it with default category
        const defaultMetadata = {
            category: ""  // Empty string for default/uncategorized
        }
        await storage.writeFile(metadataArchivePath, JSON.stringify(defaultMetadata, null, 2))
        logger.info(`Created default metadata.json for ${ensName}`)
    }

    // Copy report to live index (replaces symlink)
    const liveReportPath = `/index/live/${ensName}/report.json`
    await storage.copyFile(reportPath, liveReportPath)
    logger.info(`Copied report to live index`)

    // Try to save favicon to archive directory only if favicon exists
    if (report.favicon && faviconInfo && faviconInfo.data) {
        try {
            // Save favicon to archive directory
            const archiveFaviconPath = `/archive/${ensName}/${blockNumber}/${report.favicon}`

            logger.debug('Saving favicon to', archiveFaviconPath)
            await storage.writeFile(archiveFaviconPath, faviconInfo.data)
            
            logger.info('Favicon saved successfully to archive directory')
        } catch (error) {
            logger.error('Error saving favicon', error)
        }
    } else {
        logger.info('No favicon found, skipping favicon save')
    }
    
    // Flush changes
    await storage.flush()
}

// Check if a report for a CID already exists
export async function reportExistsForCID(ensName, cid, storage) {
    try {
        const archiveDir = `/archive/${ensName}`;
        
        // Check if the archive directory exists
        if (!(await storage.exists(archiveDir))) {
            return false;
        }
        
        // Get all block number directories
        const entries = await storage.listDirectory(archiveDir);
        const blockDirs = entries
            .filter(entry => entry.type === 'directory') // directories only
            .map(entry => entry.name)
            .filter(dir => !isNaN(Number(dir))); // Filter out non-numeric directories
        
        // If no directories, return false
        if (blockDirs.length === 0) {
            return false;
        }
        
        // Find the directory with the highest block number (latest report)
        const latestBlockDir = blockDirs
            .sort((a, b) => Number(b) - Number(a))[0]; // Sort in descending order and take first
        
        if (!latestBlockDir) {
            return false; // No valid block directories found
        }
        
        // Check only the report in the latest block directory
        const reportPath = `/archive/${ensName}/${latestBlockDir}/report.json`;
        
        try {
            const reportContent = await storage.readFileString(reportPath);
            const reportData = JSON.parse(reportContent);
            
            // Check if both the CID and version match
            // If the CID matches but version is outdated, return false so a new report will be created
            return reportData.contentHash === cid && reportData.version === ANALYSIS_VERSION;
        } catch (readError) {
            logger.error(`Error reading latest report file ${reportPath}:`, readError.message);
            return false;
        }
    } catch (error) {
        logger.warn(`Error checking if report exists: ${error.message}`);
        // If directory doesn't exist or other error, report doesn't exist
        return false;
    }
}

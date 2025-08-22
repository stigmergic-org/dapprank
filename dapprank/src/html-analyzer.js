import * as cheerio from 'cheerio'
import { getFileContent } from './ipfs-utils.js'
import { LINK_NON_FETCHING_REL_VALUES } from './constants.js'

// Analyze HTML content with Cheerio
export async function analyzeHTML(kubo, cid, filePath) {
    console.log(`Analyzing HTML file: ${filePath}`);
    const fileContent = await getFileContent(kubo, cid);
    if (!fileContent) return {};
    
    const $ = cheerio.load(fileContent);
    
    // Extract metadata
    const metadata = {
        title: $('title').text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
    };
    
    // Analyze external resources
    const externalMedia = [];
    const externalScripts = [];
    
    // Check for external images, videos, audio, iframes
    $('img, video, audio, iframe, source, object, embed, track').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src && src.startsWith('http')) {
            externalMedia.push({
                type: elem.tagName.toLowerCase(),
                url: src
            });
        }
    });
    
    // Check for external scripts and links
    $('script, link').each((i, elem) => {
        const $elem = $(elem);
        const src = $elem.attr('src') || $elem.attr('href');
        
        if (!src || !src.startsWith('http')) return;
        
        if (elem.tagName.toLowerCase() === 'link') {
            const rel = $elem.attr('rel');
            if (rel && LINK_NON_FETCHING_REL_VALUES.includes(rel.toLowerCase())) {
                return;
            }
        }
        
        externalScripts.push({
            type: elem.tagName.toLowerCase(),
            url: src
        });
    });
    
    // Extract JavaScript from script tags for AST analysis
    const scriptContents = [];
    $('script').each((i, elem) => {
        console.log(`Loading inline script ${i}`)
        const $elem = $(elem);
        const scriptType = $elem.attr('type');
        
        // Skip non-JS scripts (like application/json, text/template, etc.)
        if (scriptType && 
            !['text/javascript', 'application/javascript', 'module', ''].includes(scriptType) && 
            !scriptType.includes('javascript')) {
            console.log(`Skipping non-JS script: ${scriptType}`)
            return;
        }
        
        const content = $elem.html();
        if (content && content.trim()) {
            scriptContents.push(content);
        }
    });
    
    return {
        metadata,
        distributionPurity: {
            externalMedia,
            externalScripts
        },
        scriptContents
    };
}

// Extract favicon information from HTML
export function getFaviconPath(htmlContent, files) {
    const $ = cheerio.load(htmlContent);
    const favicons = [];
    
    // Look for favicon link tags - handle space-separated rel values
    $('link[rel*="icon"], link[rel*="shortcut"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (!href) return;
        
        // Check if this is a data URL
        if (href.startsWith('data:')) {
            // Extract mime type and data
            const dataUrlMatch = /data:([^;]+);([^,]+),(.+)/.exec(href);
            if (dataUrlMatch) {
                const mimeType = dataUrlMatch[1];
                const encoding = dataUrlMatch[2];
                
                // Determine file extension from mime type
                let ext = mimeType.split('/')[1] || 'ico';
                // Handle special case for SVG
                if (ext === 'svg+xml') {
                    ext = 'svg';
                }
                const fileName = `favicon.${ext}`;
                
                favicons.push({
                    path: fileName,
                    dataUrl: href,
                    priority: getFaviconPriority(ext),
                    isDataUrl: true
                });
            }
        } else {
            // Normalize path to match files array (remove leading ./)
            const normalizedPath = href.replace(/^\.?\//, '');
            const faviconFile = files.find(file => file.path === normalizedPath);
            
            if (faviconFile) {
                // Check type attribute first, then fallback to file extension
                const typeAttr = $(elem).attr('type');
                let ext;
                
                if (typeAttr) {
                    // Extract extension from MIME type
                    const mimeExt = typeAttr.split('/')[1];
                    if (mimeExt === 'svg+xml') {
                        ext = 'svg';
                    } else {
                        ext = mimeExt;
                    }
                    
                    // Use the MIME type extension for the filename
                    const fileName = `favicon.${ext}`;
                    
                    favicons.push({
                        path: fileName,
                        cid: faviconFile.cid,
                        priority: getFaviconPriority(ext),
                        isDataUrl: false
                    });
                } else {
                    // Fallback to file extension
                    ext = normalizedPath.split('.').pop().toLowerCase();
                    // Only use filename without path
                    const fileName = normalizedPath.split('/').pop();
                    
                    favicons.push({
                        path: fileName,
                        cid: faviconFile.cid,
                        priority: getFaviconPriority(ext),
                        isDataUrl: false
                    });
                }
            }
        }
    });
    
    // Sort favicons by priority and return the highest priority one
    if (favicons.length > 0) {
        favicons.sort((a, b) => b.priority - a.priority);
        return favicons[0];
    }
    
    // Fallback to looking for favicon.ico file directly
    const faviconFile = files.find(file => file.path === 'favicon.ico');
    return faviconFile ? {
        path: 'favicon.ico',
        cid: faviconFile.cid,
        isDataUrl: false
    } : {
        path: '',
        cid: null,
        isDataUrl: false
    };
}

function getFaviconPriority(ext) {
    const priority = {
        'ico': 100,
        'png': 90,
        'jpg': 80,
        'jpeg': 80,
        'gif': 70,
        'svg': 60,
        'webp': 50
    };
    return priority[ext] || 0;
}

import * as cheerio from 'cheerio'
import { getFileContent, getFileBinary } from './ipfs-utils.js'
import { toString } from 'uint8arrays'
import { LINK_NON_FETCHING_REL_VALUES } from './constants.js'

// Analyze HTML content with Cheerio
export async function analyzeHTML(kubo, cid, filePath) {
    // console.log(`Analyzing HTML file: ${filePath}`);
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
    const inlineScripts = [];
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
            inlineScripts.push(content);
        }
    });
    
    return {
        metadata,
        distributionPurity: {
            externalMedia,
            externalScripts
        },
        inlineScripts
    };
}

async function getHtmlDOM(kubo, files) {
    const indexHtml = files.find(file => file.path === 'index.html');
    if (!indexHtml) return { path: '', data: null }
    
    const htmlContent = await getFileContent(kubo, indexHtml.cid);
    if (!htmlContent) return { path: '', data: null }

    return cheerio.load(htmlContent)
}

export async function getWebmanifest(kubo, files) {
    const defaultResult = { data: null, icons: [], screenshots: [] }
    const $ = await getHtmlDOM(kubo, files);
    
    // Extract metadata
    let manifestPath = $('link[rel="manifest"]').attr('href');
    if (!manifestPath) return defaultResult
    // remove leading / or ./
    manifestPath = manifestPath.replace(/^\.?\//, '');
    const manifestFile = files.find(file => file.path === manifestPath);
    if (!manifestFile) return defaultResult
    const data = await getFileBinary(kubo, manifestFile.cid)
    const manifest = JSON.parse(await getFileContent(kubo, manifestFile.cid))

    // get icons and screenshots from manifest, load them from ipfs
    const processAssets = async (assets = []) => {
        const results = []
        for (const asset of assets) {
            const assetFile = files.find(file => file.path === asset.src)
            if (!assetFile) continue
            results.push({
                path: asset.src,
                data: await getFileBinary(kubo, assetFile.cid)
            })
        }
        return results
    }

    const icons = await processAssets(manifest.icons)
    const screenshots = await processAssets(manifest.screenshots)
    return {
        data: data,
        icons,
        screenshots
    }
}


/**
 * Extract the favicon from the index.html content
 * @param {string} kubo - The Kubo instance
 * @param {Object[]} files - The files in the index.html file
 * @returns { path: string, data: Uint8Array } - The favicon object
 */
export async function getFavicon(kubo, files) {
    const $ = await getHtmlDOM(kubo, files);
    const favicons = [];
    
    // Find all favicon link tags
    $('link[rel*="icon"], link[rel*="shortcut"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (!href) return;
        
        if (href.startsWith('data:')) {
            // Handle data URI
            const dataUrlMatch = /data:([^;]+);([^,]+),(.+)/.exec(href);
            if (dataUrlMatch) {
                const mimeType = dataUrlMatch[1];
                const encoding = dataUrlMatch[2];
                const base64Data = dataUrlMatch[3];
                
                let ext = mimeType.split('/')[1] || 'ico';
                if (ext === 'svg+xml') ext = 'svg';
                
                let data;
                try {
                    if (encoding === 'base64') {
                        data = new Uint8Array(Buffer.from(base64Data, 'base64'));
                    } else {
                        data = new Uint8Array(Buffer.from(decodeURIComponent(base64Data)));
                    }
                    
                    // Ensure SVG files have XML declaration
                    if (ext === 'svg') {
                        const svgString = toString(data);
                        if (!svgString.includes('<?xml')) {
                            const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
                            data = new Uint8Array(Buffer.from(xmlDeclaration + svgString));
                        }
                    }
                    
                    favicons.push({
                        path: `favicon.${ext}`,
                        data: data,
                        priority: getFaviconPriority(ext),
                        isDataUrl: true
                    });
                } catch (error) {
                    console.warn('Failed to decode data URL:', error);
                }
            }
        } else {
            // Handle file path
            const normalizedPath = href.replace(/^\.?\//, '');
            const faviconFile = files.find(file => file.path === normalizedPath);
            
            if (faviconFile) {
                const typeAttr = $(elem).attr('type');
                let ext;
                
                if (typeAttr) {
                    const mimeExt = typeAttr.split('/')[1];
                    ext = mimeExt === 'svg+xml' ? 'svg' : mimeExt;
                } else {
                    ext = normalizedPath.split('.').pop().toLowerCase();
                }
                
                favicons.push({
                    path: normalizedPath,
                    cid: faviconFile.cid,
                    priority: getFaviconPriority(ext),
                    isDataUrl: false
                });
            }
        }
    });

    for (const favicon of favicons) {
        if (!favicon.data) {
            favicon.data = await getFileBinary(kubo, favicon.cid);
        }
    }
    
    // Return best favicon if found
    if (favicons.length > 0) {
        favicons.sort((a, b) => b.priority - a.priority);
        const bestFavicon = favicons[0];
        return {
            path: bestFavicon.path,
            data: bestFavicon.data
        }
    }
    
    // Fallback to favicon.ico if no link tags found
    const faviconFile = files.find(file => file.path === 'favicon.ico');
    if (faviconFile) {
        return {
            path: 'favicon.ico',
            data: await getFileBinary(kubo, faviconFile.cid)
        }
    }
    
    return { path: '', data: null };
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

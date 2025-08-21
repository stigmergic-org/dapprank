import { formatFileSize } from '../../report-renderer';
import { renderInfoCard } from '../ui/info-card';
import { renderInfoItems } from '../ui/info-items';
import { renderNoticeCard } from '../ui/notice-card';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkHtml from 'remark-html';
import './styles.css';
import '../ui/info-items.css';

// DappSpec interfaces
interface ChainConfig {
    rpcs?: string[];
    bundlers?: string[];
    contracts?: string[];
}

interface DappSpecFallbacks {
    window?: boolean;
    rpcs?: boolean;
    bundlers?: boolean;
    dservice?: boolean;
}

interface DappSpec {
    dappspec: string;
    repository?: string;
    preserveHistory?: number;
    chains?: Record<string, ChainConfig>;
    fallbacks?: DappSpecFallbacks;
    auxiliary?: {
        url: string;
        motivation: string;
    }[];
}

// Function to render detailed report information for v2
export function renderReportDetails(report: any): string {
    let html = '';
    
    // Dappspec Section (if available)
    html += `
        <br />
        <h3>Dappspec</h3>
        <div class="report-section-info">
            <p>The dappspec is a JSON file that describes the dapp. It is used to determine the dapp's dependencies and to document fallback mechanisms for the dapp to work in case of network failures. More infomation can be found in the <a href="/dappspec">dappspec specification</a>.</p>
        </div>
        <div class="report-section">
            ${renderDappspecSection(report)}
        </div>
    `;
    
    // Distribution Section
    html += `
        <h3>Distribution</h3>
        <div class="report-section-info">
            <p>Loading scripts or media from external sources is a common way to introduce security vulnerabilities. Scripts that are loaded from external sources could essentially change any aspect of the dapp and should be considered as serious security issues. Media loaded from external sources could be used to track users and should ideally be avoided completely.</p>
        </div>
        <div class="report-section">
            ${renderDistributionSection(report)}
        </div>
    `;
    
    // Networking Section
    html += `
        <h3>Networking</h3>
        <div class="report-section-info">
            <p>Most modern applications require some form of networking functionality. However, we don't want dapps to just arbitrarily steal our data or track us. This section breaks down networking into a few main categories to help you understand how the dapp communicates with the outside world.</p>
            <ul>
                <li><strong>RPC:</strong> Requests made to an Ethereum RPC.</li>
                <li><strong>Bundler:</strong> Requests made to an Ethereum 4337 Bundler.</li>
                <li><strong>Self:</strong> Requests made to fetch resources from the same origin as the dapp (e.g. files listed within the dapp's own repository).</li>
                <li><strong>Auxiliary:</strong> Requests made to non-essential external services. All escessive requests are listed here.</li>
            </ul>
        </div>
        <div class="report-section">
            ${renderNetworkingSection(report)}
        </div>
    `;
    
    // Libraries Section
    html += `
        <h3>Libraries</h3>
        <div class="report-section-info">
            <p>Libraries are third-party JavaScript code that are distributed with the dapp. The libraries listed below are detected by analyzing the dapp's source code.</p>
        </div>
        <div class="report-section">
            ${renderLibrariesSection(report)}
        </div>
    `;
    
    return html;
}

// Content Hash Section
function renderContentHashSection(report: any): string {
    return `
        <div class="report-hash-value">
            ${report.contentHash}
        </div>
        <div class="hash-button-container">
            <button class="hash-link" title="Inspect IPFS Content" onclick="window.open('https://webui.ipfs.io/#/ipfs/${report.contentHash}', '_blank')">
                <span class="hash-icon">🔍</span>Explore IPFS
            </button>
            <button class="copy-hash-btn" title="Copy to clipboard" onclick="navigator.clipboard.writeText('${report.contentHash}').then(() => { this.classList.add('copied'); setTimeout(() => this.classList.remove('copied'), 2000); })">
                <span class="hash-icon">📋</span>Copy Hash
            </button>
        </div>
    `;
}

// Dappspec Section
function renderDappspecSection(report: any): string {
    const dappspec = report.dappspec as DappSpec | undefined;
    let html = `<div class="dappspec-container">`;

    // Show warning first if no dappspec found
    if (!dappspec) {
        html += renderNoticeCard({
            type: 'warning',
            message: 'No dappspec.json manifest found.'
        });
    }

    // Dapp Metadata Card - Always show this
    const metadataItems = [
        {
            icon: '🔐',
            title: 'Content Hash',
            details: [{
                title: '',
                content: renderContentHashSection(report)
            }]
        }
    ];

    // Add repository if available from dappspec
    if (dappspec?.repository) {
        metadataItems.push({
            icon: '📦',
            title: 'Repository',
            details: [{
                title: '',
                content: `
                    <a href="${dappspec.repository}" target="_blank" class="repository-link">
                        ${dappspec.repository}
                    </a>
                `
            }]
        });
    }

    // Add size if available
    if (report.totalSize) {
        metadataItems.push({
            icon: '💾',
            title: 'Total Size',
            details: [{
                title: '',
                content: `<ul><li><code>${formatFileSize(report.totalSize)}</code></li></ul>`
            }]
        });
    }

    // Add MIME type if available
    if (report.rootMimeType) {
        metadataItems.push({
            icon: '🗃️',
            title: 'MIME Type',
            details: [{
                title: '',
                content: `<ul><li><code>${report.rootMimeType}</code></li></ul>`
            }]
        });
    }

    html += renderInfoCard({
        title: 'Dapp Metadata',
        content: renderInfoItems(metadataItems)
    });

    // Return early if no dappspec
    if (!dappspec) {
        html += `</div>`;
        return html;
    }

    // Chains information
    if (dappspec.chains && Object.keys(dappspec.chains).length > 0) {
        const chainItems = Object.entries(dappspec.chains).map(([chainId, chainData]) => {
            const details = [];
            
            if (chainData.rpcs?.length > 0) {
                details.push({
                    title: 'RPC Endpoints',
                    content: `<ul>${chainData.rpcs.map(rpc => `<li><code>${rpc}</code></li>`).join('')}</ul>`
                });
            }

            if (chainData.bundlers?.length > 0) {
                details.push({
                    title: 'Bundlers',
                    content: `<ul>${chainData.bundlers.map(bundler => `<li><code>${bundler}</code></li>`).join('')}</ul>`
                });
            }

            if (chainData.contracts?.length > 0) {
                details.push({
                    title: 'Contracts',
                    content: `<ul>${chainData.contracts.map(contract => `
                        <li>
                            <code>${contract}</code>
                            <a href="https://repo.sourcify.dev/contracts/full_match/${chainId}/${contract}" 
                               target="_blank" 
                               class="sourcify-link" 
                               title="View on Sourcify">
                                <span class="item-icon">🔍</span>
                            </a>
                        </li>
                    `).join('')}</ul>`
                });
            }

            return {
                icon: '⛓️',
                title: getNetworkName(chainId),
                details
            };
        });

        html += renderInfoCard({
            title: 'Blockchain Support',
            description: 'The dapp claims to interact only with the following blockchains. Using the RPC, Bundler, and smart contracts specified below.',
            content: renderInfoItems(chainItems)
        });
    }

    // Fallbacks information
    if (dappspec.fallbacks) {
        let fallbackItems = [];

        if (dappspec.fallbacks.window) {
            const { isSupported, files } = getWindowEthereumDetails(report);
            fallbackItems.push({
                icon: '🔄',
                title: 'Window.ethereum Injection',
                detected: isSupported ? '✓ Detected' : '✗ Not Detected',
                details: [
                    {
                        title: '',
                        content: 'The dapp supports using injected Web3 providers from browser wallets.'
                    },
                    ...(isSupported ? [{
                        title: 'Detected in:',
                        content: `<ul>${files.map(file => `<li><code>${file}</code></li>`).join('')}</ul>`
                    }] : [])
                ]
            });
        }

        if (dappspec.fallbacks.rpcs) {
            const { isSupported, files, motivation } = getFallbackDetectionDetails(report, 'rpc');
            fallbackItems.push({
                icon: '🔄',
                title: 'RPC Endpoint Override',
                detected: isSupported ? '✓ Detected' : '✗ Not Detected',
                details: [
                    {
                        title: '',
                        content: 'Custom RPC endpoints can be specified via <code>?ds-rpc-{chainId}=url</code> query parameters.'
                    },
                    ...(isSupported ? [
                        {
                            title: 'Detected in:',
                            content: `<ul>${files.map(file => `<li><code>${file}</code></li>`).join('')}</ul>`
                        },
                        ...(motivation ? [{
                            title: 'Implementation:',
                            content: convertMarkdownToHtml(motivation)
                        }] : [])
                    ] : [])
                ]
            });
        }

        if (dappspec.fallbacks.bundlers) {
            const { isSupported, files, motivation } = getFallbackDetectionDetails(report, 'bundler');
            fallbackItems.push({
                icon: '🔄',
                title: 'Bundler Endpoint Override',
                detected: isSupported ? '✓ Detected' : '✗ Not Detected',
                details: [
                    {
                        title: '',
                        content: 'Custom bundler endpoints can be specified via <code>?ds-bundler-{chainId}=url</code> query parameters.'
                    },
                    ...(isSupported ? [
                        {
                            title: 'Detected in:',
                            content: `<ul>${files.map(file => `<li><code>${file}</code></li>`).join('')}</ul>`
                        },
                        ...(motivation ? [{
                            title: 'Implementation:',
                            content: convertMarkdownToHtml(motivation)
                        }] : [])
                    ] : [])
                ]
            });
        }

        if (dappspec.fallbacks.dservice) {
            const { isSupported, files, motivation } = getFallbackDetectionDetails(report, 'dservice');
            fallbackItems.push({
                icon: '🔄',
                title: 'DService Override',
                detected: isSupported ? '✓ Detected' : '✗ Not Detected',
                details: [
                    {
                        title: '',
                        content: 'Custom DService endpoints can be specified via <code>?ds-{ensName}=url</code> query parameters.'
                    },
                    ...(isSupported ? [
                        {
                            title: 'Detected in:',
                            content: `<ul>${files.map(file => `<li><code>${file}</code></li>`).join('')}</ul>`
                        },
                        ...(motivation ? [{
                            title: 'Implementation:',
                            content: convertMarkdownToHtml(motivation)
                        }] : [])
                    ] : [])
                ]
            });
        }

        html += renderInfoCard({
            title: 'Fallback Support',
            content: renderInfoItems(fallbackItems)
        });
    }

    // Auxiliary services
    if (dappspec.auxiliary?.length > 0) {
        const auxiliaryItems = dappspec.auxiliary.map(service => ({
            icon: '🔗',
            title: new URL(service.url).hostname,
            details: [
                {
                    title: 'URL:',
                    content: `<ul><li><code>${service.url}</code></li></ul>`
                },
                {
                    title: 'Purpose:',
                    content: convertMarkdownToHtml(service.motivation)
                }
            ]
        }));

        html += renderInfoCard({
            title: 'Auxiliary Services',
            description: 'The dapp uses the following non-essential external services to enhance its functionality. These services are not required for core operations but provide additional features.',
            content: renderInfoItems(auxiliaryItems)
        });
    }

    html += `</div>`;
    return html;
}

// Distribution Section
function renderDistributionSection(report: any): string {
    const distributionPurity = report.distributionPurity || {};
    const externalScripts = distributionPurity.externalScripts || [];
    const externalMedia = distributionPurity.externalMedia || [];
    
    if (externalScripts.length === 0 && externalMedia.length === 0) {
        return renderNoticeCard({
            type: 'success',
            message: 'No external dependencies detected. The dapp is fully distributed and self-contained.'
        });
    }

    let html = '';

    // External Scripts Card
    if (externalScripts.length > 0) {
        const scriptItems = Object.entries(
            externalScripts.reduce((acc: any, script: any) => {
                const file = script.file || 'index.html';
                if (!acc[file]) acc[file] = [];
                acc[file].push(script);
                return acc;
            }, {})
        ).map(([file, scripts]: [string, any[]]) => ({
            icon: '📄',
            title: file,
            details: scripts.map((script) => {
                const details = [];
                
                // Add URLs
                details.push({
                    title: `URL${script.occurences?.length > 1 ? 's' : ''}:`,
                    content: !script.occurences || script.occurences.length === 0 ? 
                        `<div class="warning-text">
                            <span class="warning-icon">⚠️</span>
                            <span>Warning: This code could load any external script</span>
                        </div>` :
                        `<ul class="url-list">
                            ${script.occurences.map((occurrence: any) => {
                                const url = typeof occurrence === 'string' ? occurrence : occurrence.url;
                                const type = typeof occurrence === 'string' ? 'script' : occurrence.type || 'script';
                                return url ? `
                                    <li>
                                        <div class="detail-info">
                                            <span class="detail-type">Type: ${type}</span>
                                        </div>
                                        <code>${escapeHtml(url)}</code>
                                    </li>` : '';
                            }).filter(Boolean).join('') || ''}
                        </ul>`
                });

                return details;
            }).flat()
        }));

        html += renderInfoCard({
            title: 'External Scripts',
            description: 'The dapp loads JavaScript code from the following external sources:',
            content: renderInfoItems(scriptItems)
        });
    }

    // External Media Card
    if (externalMedia.length > 0) {
        const mediaItems = Object.entries(
            externalMedia.reduce((acc: any, media: any) => {
                const file = media.file || 'index.html';
                if (!acc[file]) acc[file] = [];
                acc[file].push(media);
                return acc;
            }, {})
        ).map(([file, medias]: [string, any[]]) => ({
            icon: '📄',
            title: file,
            details: medias.map((media) => {
                const details = [];
                
                // Add URLs
                details.push({
                    title: `URL${media.occurences?.length > 1 ? 's' : ''}:`,
                    content: !media.occurences || media.occurences.length === 0 ? 
                        `<div class="warning-text">
                            <span class="warning-icon">⚠️</span>
                            <span>Warning: This code could load any external media</span>
                        </div>` :
                        `<ul class="url-list">
                            ${media.occurences.map((occurrence: any) => {
                                const url = typeof occurrence === 'string' ? occurrence : occurrence.url;
                                const type = typeof occurrence === 'string' ? 'media' : occurrence.type || 'media';
                                return url ? `
                                    <li>
                                        <div class="detail-info">
                                            <span class="detail-type">Type: ${type}</span>
                                        </div>
                                        <code>${escapeHtml(url)}</code>
                                    </li>` : '';
                            }).filter(Boolean).join('') || ''}
                        </ul>`
                });

                return details;
            }).flat()
        }));

        html += renderInfoCard({
            title: 'External Media',
            description: 'The dapp loads media content from the following external sources:',
            content: renderInfoItems(mediaItems)
        });
    }

    return html;
}

// Networking Section
function renderNetworkingSection(report: any): string {
    const networkingPurity = report.networkingPurity || [];
    
    if (networkingPurity.length === 0) {
        return renderNoticeCard({
            type: 'info',
            message: 'No outbound network requests detected. The dapp operates without external service dependencies.'
        });
    }
    
    // Group by type
    const networkingByType = networkingPurity.reduce((acc: any, item: any) => {
        const occurrences = item.occurences || [];
        occurrences.forEach((occurrence: any) => {
            const type = occurrence.type || 'unknown';
            if (!acc[type]) acc[type] = [];
            acc[type].push({
                file: item.file,
                urls: occurrence.urls || [],
                method: occurrence.method,
                library: occurrence.library,
                motivation: occurrence.motivation
            });
        });
        return acc;
    }, {});

    // Return early if no networking types found
    if (Object.keys(networkingByType).length === 0) {
        return renderNoticeCard({
            type: 'info',
            message: 'No networking endpoints were detected in the analysis.'
        });
    }

    // Render each type as a separate info card
    return Object.entries(networkingByType).map(([type, items]: [string, any]) => {
        // Group items by file
        const itemsByFile: Record<string, any[]> = {};
        items.forEach((item: any) => {
            if (!itemsByFile[item.file]) {
                itemsByFile[item.file] = [];
            }
            itemsByFile[item.file].push(item);
        });

        // Create info items for each file
        const fileItems = Object.entries(itemsByFile).map(([file, fileItems], index, array) => ({
            icon: '📄',
            title: file,
            details: [
                ...fileItems.map((item, itemIndex) => {
                    const details = [];
                    
                    // Add API and Library info if present
                    if (item.method || item.library) {
                        details.push({
                            title: 'Detected:',
                            content: `
                                ${item.method ? `<span class="detail-method">API: ${item.method}</span>` : ''}
                                ${item.library ? `<span class="detail-library">Library: ${item.library}</span>` : ''}
                            `
                        });
                    }

                    // Add URLs
                    details.push({
                        title: `URL${item.urls.length > 1 ? 's' : ''}:`,
                        content: item.urls.length === 0 ? 
                            `<div class="warning-text">
                                <span class="warning-icon">⚠️</span>
                                <span>Warning: This code could make requests to any URL</span>
                            </div>` :
                            `<ul class="url-list">
                                ${item.urls.map((url: string) => `<li><code>${escapeHtml(url)}</code></li>`).join('')}
                            </ul>`
                    });

                    // Add motivation if present
                    if (item.motivation) {
                        details.push({
                            title: 'Motivation:',
                            content: convertMarkdownToHtml(item.motivation)
                        });
                    }

                    // Only add breaks between items if there are multiple items
                    if (fileItems.length > 1 && itemIndex < fileItems.length - 1) {
                        details.push({
                            title: '',
                            content: '<div class="item-separator"></div>'
                        });
                    }

                    return details;
                }).flat(),
            ]
        }));

        return renderInfoCard({
            title: `${type.charAt(0).toUpperCase() + type.slice(1)} Endpoints`,
            content: renderInfoItems(fileItems)
        });
    }).join('');
}

// Helper function to convert markdown to HTML
function convertMarkdownToHtml(markdown: string): string {
    if (!markdown) return '';
    
    try {
        const file = unified()
            .use(remarkParse)
            .use(remarkHtml)
            .processSync(markdown);
            
        // Add markdown-content class to wrap the content
        let html = String(file);
        return `<div class="markdown-content">${html}</div>`;
    } catch (error) {
        console.error('Error converting markdown to HTML:', error);
        return escapeHtml(markdown);
    }
}

// Helper function to escape HTML tags
function escapeHtml(text: string): string {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Libraries Section
function renderLibrariesSection(report: any): string {
    const libraries = report.libraryUsage || [];
    
    if (!Array.isArray(libraries) || libraries.length === 0) {
        return renderNoticeCard({
            type: 'info',
            message: 'No JavaScript libraries were detected in the analysis.'
        });
    }
    
    const libraryEntries = libraries.map((fileEntry: any) => {
        if (!fileEntry || !fileEntry.file || !Array.isArray(fileEntry.occurences)) return '';
        
        const entries = fileEntry.occurences.map((lib: any) => {
            if (!lib || typeof lib !== 'object') return '';
            const name = lib.name || 'Unknown Library';
            const motivation = lib.motivation || 'No motivation provided';
            
            const htmlMotivation = convertMarkdownToHtml(motivation);
            
            return `
                <div class="library-item">
                    <div class="library-name">
                        <span class="item-icon">📚</span>
                        ${name}
                        <span class="library-file">${fileEntry.file}</span>
                    </div>
                    <div class="library-motivation">
                        ${htmlMotivation}
                    </div>
                </div>
            `;
        });
        
        return entries.join('');
    });
    
    return `
        <div class="libraries-list">
            ${libraryEntries.join('')}
        </div>
    `;
}

// Helper function to render grouped items
function renderGroupedItems(items: any[], itemType: string, extractFile: (item: any) => string, extractDetails: (item: any) => any[]): string {
    if (!items || items.length === 0) return '';
    
    const itemsByFile: Record<string, any[]> = {};
    
    items.forEach(item => {
        const file = extractFile(item);
        if (!itemsByFile[file]) {
            itemsByFile[file] = [];
        }
        // Don't spread the details, keep each occurrence as a single item
        itemsByFile[file].push(...extractDetails(item));
    });
    
    return `
        <div class="grouped-items">
            <h4>${itemType} (${items.length})</h4>
            <ul class="report-list">
                ${Object.entries(itemsByFile).map(([file, details]) => `
                    <li>
                        <div class="file-path">
                            <span class="item-icon">📄</span>
                            ${file}
                        </div>
                        <ul class="report-sublist">
                            ${details.map(detail => {
                                if (typeof detail === 'string') {
                                    return `<li>${detail}</li>`;
                                } else {
                                    let detailHtml = `
                                        <li>
                                            <div class="detail-info">
                                                ${detail.type ? `<span class="detail-type">Type: ${detail.type}</span>` : ''}
                                                ${detail.method ? `<span class="detail-method">Method: ${detail.method}</span>` : ''}
                                                ${detail.library ? `<span class="detail-library">Library: ${detail.library}</span>` : ''}
                                            </div>
                                            <div class="detail-url">
                                                ${detail.url || detail.urls ? `
                                                    <span class="url-label">URL${detail.urls && detail.urls.length > 1 ? 's' : ''}:</span>
                                                    <span class="url-value">
                                                        ${detail.urls ? (
                                                            detail.urls.length === 0 ? '⚠️ Any url could be used' :
                                                            `<ul class="url-list">
                                                                ${detail.urls.map((url: string) => `<li><code>${escapeHtml(url)}</code></li>`).join('')}
                                                            </ul>`
                                                        ) : (
                                                            detail.url ? `<code>${escapeHtml(detail.url)}</code>` : '<any>'
                                                        )}
                                                    </span>
                                                ` : ''}
                                            </div>
                                            ${detail.motivation ? `
                                                <div class="networking-motivation">
                                                    ${convertMarkdownToHtml(detail.motivation)}
                                                </div>
                                            ` : ''}`;
                                    
                                    detailHtml += `</li>`;
                                    return detailHtml;
                                }
                            }).join('')}
                        </ul>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
}

// Helper function to render distribution information in a readable format
export function renderDistributionInfo(purity: any): string {
    if (!purity) return '<p>No distribution information available.</p>';
    
    const externalScripts = purity.externalScripts || [];
    const externalMedia = purity.externalMedia || [];
    
    if (externalScripts.length === 0 && externalMedia.length === 0) {
        return '<p>✅ No external scripts or media detected. The dapp is fully distributed and self-contained.</p>';
    }
    
    let html = '';
    
    if (externalScripts.length > 0) {
        html += `<p>️📜 External scripts detected (${externalScripts.length})</p>`;
    }
    
    if (externalMedia.length > 0) {
        html += `<p>🎬 External media detected (${externalMedia.length})</p>`;
    }
    
    return html;
}

// Helper function to render networking information in a readable format
export function renderNetworkingInfo(purity: any): string {
    if (!purity || purity.length === 0) {
        return '<p>✅ No outbound network requests detected. The dapp operates without external service dependencies.</p>';
    }
    
    const networkingByType = purity.reduce((acc: any, item: any) => {
        const type = item.type || 'unknown';
        if (!acc[type]) acc[type] = 0;
        acc[type] += item.urls.length;
        return acc;
    }, {});
    
    return Object.entries(networkingByType)
        .map(([type, count]) => `<p>🌐 ${type.charAt(0).toUpperCase() + type.slice(1)} endpoints detected (${count})</p>`)
        .join('');
}

// Helper function to render libraries information in a readable format
export function renderLibrariesInfo(libraries: any[]): string {
    if (!libraries || libraries.length === 0) {
        return '<p>ℹ️ No JavaScript libraries detected.</p>';
    }
    
    return `<p>📚 ${libraries.length} JavaScript ${libraries.length === 1 ? 'library' : 'libraries'} detected</p>`;
}

// Helper function to get network name from chain ID
function getNetworkName(chainId: string): string {
    const networks: Record<string, string> = {
        '1': 'Ethereum Mainnet',
        '5': 'Goerli',
        '11155111': 'Sepolia',
        '137': 'Polygon',
        '80001': 'Mumbai',
        '42161': 'Arbitrum One',
        '421613': 'Arbitrum Goerli',
        '10': 'Optimism',
        '420': 'Optimism Goerli',
        '56': 'BNB Smart Chain',
        '97': 'BNB Testnet',
        '100': 'Gnosis Chain',
        '42220': 'Celo',
        '44787': 'Celo Alfajores',
        '43114': 'Avalanche C-Chain',
        '43113': 'Avalanche Fuji',
        '250': 'Fantom Opera',
        '4002': 'Fantom Testnet',
        '1284': 'Moonbeam',
        '1285': 'Moonriver'
    };
    return networks[chainId] || `Chain ${chainId}`;
}

// Helper function to get fallback detection details
function getFallbackDetectionDetails(report: any, type: string): { isSupported: boolean, files: string[], motivation?: string } {
    const fallbacks = report.fallbacks || [];
    const detectedFallbacks = fallbacks.filter((fallback: any) => 
        fallback.occurences.some((occurrence: any) => occurrence.type === type)
    );
    
    if (detectedFallbacks.length === 0) {
        return { isSupported: false, files: [] };
    }
    
    const files = detectedFallbacks.map((fallback: any) => fallback.file);
    const motivation = detectedFallbacks[0]?.occurences.find((o: any) => o.type === type)?.motivation;
    
    return {
        isSupported: true,
        files,
        motivation
    };
}

// Helper function to get window.ethereum detection details
function getWindowEthereumDetails(report: any): { isSupported: boolean, files: string[] } {
    const ethereum = report.ethereum || [];
    if (ethereum.length === 0) {
        return { isSupported: false, files: [] };
    }
    
    return {
        isSupported: true,
        files: ethereum.map((item: any) => item.file)
    };
}
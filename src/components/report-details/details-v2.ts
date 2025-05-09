import { formatFileSize } from '../../report-renderer';
import './styles.css';

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
    auxiliary?: string[];
}

// Function to render detailed report information for v2
export function renderReportDetails(report: any): string {
    let html = '';
    
    // Content Hash Section
    html += renderContentHashSection(report);
    
    // Basic Info Section
    html += renderBasicInfoSection(report);
    
    // Dappspec Section (if available)
    if (report.dappspec) {
        html += `
            <h3>Dappspec Support</h3>
            <div class="report-section">
                ${renderDappspecSection(report)}
            </div>
        `;
    }
    
    // Distribution Section
    html += `
        <h3>Distribution</h3>
        <div class="report-section">
            ${renderDistributionSection(report)}
        </div>
    `;
    
    // Networking Section
    html += `
        <h3>Networking</h3>
        <div class="report-section">
            ${renderNetworkingSection(report)}
        </div>
    `;
    
    // Libraries Section
    html += `
        <h3>Libraries</h3>
        <div class="report-section">
            ${renderLibrariesSection(report)}
        </div>
    `;
    
    return html;
}

// Content Hash Section
function renderContentHashSection(report: any): string {
    return `
        <div class="report-hash-comparison">
            <div class="report-hash-item">
                <strong>Content Hash:</strong>
                <span class="report-hash-value">
                    <span class="item-icon">🔐</span>${report.contentHash}
                </span>
                <div class="hash-button-container">
                    <button class="hash-link" title="Inspect IPFS Content" onclick="window.open('https://webui.ipfs.io/#/ipfs/${report.contentHash}', '_blank')">
                        <span class="hash-icon">🔍</span>Explore IPFS
                    </button>
                    <button class="copy-hash-btn" title="Copy to clipboard" onclick="navigator.clipboard.writeText('${report.contentHash}').then(() => { this.classList.add('copied'); setTimeout(() => this.classList.remove('copied'), 2000); })">
                        <span class="hash-icon">📋</span>Copy Hash
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Basic Info Section
function renderBasicInfoSection(report: any): string {
    return `
        <div class="report-info">
            <div class="report-grid">
                <div class="report-item">
                    <span class="report-label">Total Size:</span>
                    <span class="report-value">
                        <span class="item-icon">💾</span> ${formatFileSize(report.totalSize)}
                    </span>
                </div>
                <div class="report-item">
                    <span class="report-label">Created at:</span>
                    <span class="report-value">
                        <span class="item-icon">📅</span> ${new Date(report.timestamp * 1000).toISOString().replace('T', ' ').split('.')[0]}
                    </span>
                </div>
                <div class="report-item">
                    <span class="report-label">Block number:</span>
                    <span class="report-value">
                        <span class="item-icon">⛓️</span> ${report.blockNumber}
                    </span>
                </div>
                ${report.rootMimeType ? `
                <div class="report-item">
                    <span class="report-label">MIME Type:</span>
                    <span class="report-value">
                        <span class="item-icon">🗃️</span> ${report.rootMimeType}
                    </span>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Distribution Section
function renderDistributionSection(report: any): string {
    const distributionPurity = report.distributionPurity || {};
    const externalScripts = distributionPurity.externalScripts || [];
    const externalMedia = distributionPurity.externalMedia || [];
    
    if (externalScripts.length === 0 && externalMedia.length === 0) {
        return `
            <div class="report-success-message">
                <span class="success-icon">✅</span>
                <p>No external dependencies detected. The dapp is fully distributed and self-contained.</p>
            </div>
        `;
    }
    
    return `
        ${renderGroupedItems(
            externalScripts,
            'External Scripts',
            (script) => script.file || 'index.html',
            (script) => script.occurences || []
        )}
        ${renderGroupedItems(
            externalMedia,
            'External Media',
            (media) => media.file || 'index.html',
            (media) => media.occurences || []
        )}
    `;
}

// Helper function to get fallback title and params
function getFallbackInfo(type: string): { title: string, params: string } {
    switch (type) {
        case 'rpc':
            return {
                title: 'Ethereum RPC Fallback',
                params: '?ds-rpc-[chain-id>=urlEncode(url)'
            };
        case 'bundler':
            return {
                title: 'Ethereum 4337 Bundler Fallback',
                params: '?ds-bundler-<chain-id>=urlEncode(url)'
            };
        case 'dservice':
            return {
                title: 'Dservice Fallback',
                params: '?ds-self=urlEncode(url), ?ds-<ens-name>=urlEncode(url)'
            };
        default:
            return {
                title: `${type.charAt(0).toUpperCase() + type.slice(1)} Fallback`,
                params: ''
            };
    }
}

// Networking Section
function renderNetworkingSection(report: any): string {
    const networkingPurity = report.networkingPurity || [];
    
    if (networkingPurity.length === 0) {
        return `
            <div class="report-success-message">
                <span class="success-icon">✅</span>
                <p>No outbound network requests detected. The dapp operates without external service dependencies.</p>
            </div>
        `;
    }
    
    let html = '';
    
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
    
    // Render networking endpoints
    if (Object.keys(networkingByType).length > 0) {
        html += Object.entries(networkingByType).map(([type, items]: [string, any]) => `
            <div class="networking-group">
                <h4>${type.charAt(0).toUpperCase() + type.slice(1)} Endpoints</h4>
                ${renderGroupedItems(
                    items,
                    type,
                    (item) => item.file || 'unknown',
                    (item) => [item] // Keep each occurrence as a single item
                )}
            </div>
        `).join('');
    }
    
    return html;
}

// Helper function to convert simple markdown to HTML
function convertMarkdownToHtml(markdown: string): string {
    if (!markdown) return '';
    
    return markdown
        // Convert code blocks with backticks
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Convert line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        // Convert lists
        .replace(/^\s*-\s+(.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        // Wrap in paragraph if not already wrapped
        .replace(/^(?!<[up]>)(.+)(?!<\/[up]>)$/gm, '<p>$1</p>');
}

// Libraries Section
function renderLibrariesSection(report: any): string {
    const libraries = report.libraryUsage || [];
    
    if (!Array.isArray(libraries) || libraries.length === 0) {
        return `
            <div class="report-info-message">
                <span class="info-icon">ℹ️</span>
                <p>No JavaScript libraries were detected in the analysis.</p>
            </div>
        `;
    }
    
    return `
        <div class="libraries-list">
            ${libraries.map((fileEntry: any) => {
                if (!fileEntry || !fileEntry.file || !Array.isArray(fileEntry.occurences)) return '';
                
                return fileEntry.occurences.map((lib: any) => {
                    if (!lib || typeof lib !== 'object') return '';
                    const name = lib.name || 'Unknown Library';
                    const motivation = lib.motivation || 'No motivation provided';
                    
                    return `
                        <div class="library-item">
                            <div class="library-name">
                                <span class="item-icon">📚</span>
                                ${name}
                                <span class="library-file">${fileEntry.file}</span>
                            </div>
                            <div class="library-motivation">
                                ${convertMarkdownToHtml(motivation)}
                            </div>
                        </div>
                    `;
                }).join('');
            }).join('')}
        </div>
    `;
}

// Dappspec Section
function renderDappspecSection(report: any): string {
    const dappspec = report.dappspec as DappSpec | undefined;
    
    if (!dappspec) {
        return `
            <div class="report-info-message">
                <span class="info-icon">ℹ️</span>
                <p>No dappspec.json manifest found.</p>
            </div>
        `;
    }

    let html = `<div class="dappspec-container">`;

    // Repository information
    if (dappspec.repository) {
        html += `
            <div class="dappspec-subsection">
                <h4>Repository</h4>
                <a href="${dappspec.repository}" target="_blank" class="repository-link">
                    <span class="item-icon">📦</span>
                    ${dappspec.repository}
                </a>
            </div>
        `;
    }

    // Chains information
    if (dappspec.chains && Object.keys(dappspec.chains).length > 0) {
        html += `
            <div class="dappspec-subsection">
                <h4>Chain Support</h4>
        `;

        for (const [chainId, chainData] of Object.entries(dappspec.chains)) {
            html += `<h5>${getNetworkName(chainId)}</h5>`;
            
            if (chainData.rpcs?.length > 0) {
                html += `
                    <div class="dappspec-item">
                        <div class="dappspec-type">
                            <span class="item-icon">🔌</span>
                            RPC Endpoints (${chainData.rpcs.length})
                        </div>
                        <div class="dappspec-motivation">
                            <ul>
                                ${chainData.rpcs.map(rpc => `<li><code>${rpc}</code></li>`).join('')}
                            </ul>
                        </div>
                    </div>
                `;
            }

            if (chainData.bundlers?.length > 0) {
                html += `
                    <div class="dappspec-item">
                        <div class="dappspec-type">
                            <span class="item-icon">📦</span>
                            Bundlers (${chainData.bundlers.length})
                        </div>
                        <div class="dappspec-motivation">
                            <ul>
                                ${chainData.bundlers.map(bundler => `<li><code>${bundler}</code></li>`).join('')}
                            </ul>
                        </div>
                    </div>
                `;
            }

            if (chainData.contracts?.length > 0) {
                html += `
                    <div class="dappspec-item">
                        <div class="dappspec-type">
                            <span class="item-icon">📜</span>
                            Contracts (${chainData.contracts.length})
                        </div>
                        <div class="dappspec-motivation">
                            <ul>
                                ${chainData.contracts.map(contract => `
                                    <li>
                                        <code>${contract}</code>
                                        <a href="https://repo.sourcify.dev/contracts/full_match/${chainId}/${contract}" 
                                           target="_blank" 
                                           class="sourcify-link" 
                                           title="View on Sourcify">
                                            <span class="item-icon">🔍</span>
                                        </a>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                `;
            }
        }

        html += `</div>`;
    }

    // Fallbacks information
    if (dappspec.fallbacks) {
        html += `
            <div class="dappspec-subsection">
                <h4>Fallback Support</h4>
                <div class="dappspec-list">
        `;

        if (dappspec.fallbacks.window) {
            const { isSupported, files } = getWindowEthereumDetails(report);
            html += `
                <div class="dappspec-item">
                    <div class="dappspec-type">
                        <span class="item-icon">🔄</span>
                        Window.ethereum Injection
                        <span class="${isSupported ? 'fallback-detected' : 'fallback-not-detected'}">
                            ${isSupported ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </div>
                    <div class="dappspec-motivation">
                        <p>The dapp supports using injected Web3 providers from browser wallets.</p>
                        ${isSupported ? `
                            <div class="detection-details">
                                <strong>Detected in:</strong>
                                <ul>
                                    ${files.map(file => `<li><code>${file}</code></li>`).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if (dappspec.fallbacks.rpcs) {
            const { isSupported, files, motivation } = getFallbackDetectionDetails(report, 'rpc');
            html += `
                <div class="dappspec-item">
                    <div class="dappspec-type">
                        <span class="item-icon">🔄</span>
                        RPC Endpoint Override
                        <span class="${isSupported ? 'fallback-detected' : 'fallback-not-detected'}">
                            ${isSupported ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </div>
                    <div class="dappspec-motivation">
                        <p>Custom RPC endpoints can be specified via <code>?ds-rpc-{chainId}=url</code> query parameters.</p>
                        ${isSupported ? `
                            <div class="detection-details">
                                <strong>Detected in:</strong>
                                <ul>
                                    ${files.map(file => `<li><code>${file}</code></li>`).join('')}
                                </ul>
                                ${motivation ? `
                                    <strong>Implementation:</strong>
                                    <div class="fallback-implementation">
                                        ${convertMarkdownToHtml(motivation)}
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if (dappspec.fallbacks.bundlers) {
            const { isSupported, files, motivation } = getFallbackDetectionDetails(report, 'bundler');
            html += `
                <div class="dappspec-item">
                    <div class="dappspec-type">
                        <span class="item-icon">🔄</span>
                        Bundler Endpoint Override
                        <span class="${isSupported ? 'fallback-detected' : 'fallback-not-detected'}">
                            ${isSupported ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </div>
                    <div class="dappspec-motivation">
                        <p>Custom bundler endpoints can be specified via <code>?ds-bundler-{chainId}=url</code> query parameters.</p>
                        ${isSupported ? `
                            <div class="detection-details">
                                <strong>Detected in:</strong>
                                <ul>
                                    ${files.map(file => `<li><code>${file}</code></li>`).join('')}
                                </ul>
                                ${motivation ? `
                                    <strong>Implementation:</strong>
                                    <div class="fallback-implementation">
                                        ${convertMarkdownToHtml(motivation)}
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if (dappspec.fallbacks.dservice) {
            const { isSupported, files, motivation } = getFallbackDetectionDetails(report, 'dservice');
            html += `
                <div class="dappspec-item">
                    <div class="dappspec-type">
                        <span class="item-icon">🔄</span>
                        DService Override
                        <span class="${isSupported ? 'fallback-detected' : 'fallback-not-detected'}">
                            ${isSupported ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </div>
                    <div class="dappspec-motivation">
                        <p>Custom DService endpoints can be specified via <code>?ds-{ensName}=url</code> query parameters.</p>
                        ${isSupported ? `
                            <div class="detection-details">
                                <strong>Detected in:</strong>
                                <ul>
                                    ${files.map(file => `<li><code>${file}</code></li>`).join('')}
                                </ul>
                                ${motivation ? `
                                    <strong>Implementation:</strong>
                                    <div class="fallback-implementation">
                                        ${convertMarkdownToHtml(motivation)}
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
    }

    // Auxiliary services
    if (dappspec.auxiliary?.length > 0) {
        html += `
            <div class="dappspec-subsection">
                <h4>Auxiliary Services</h4>
                <div class="dappspec-list">
                    <div class="dappspec-item">
                        <div class="dappspec-type">
                            <span class="item-icon">🔗</span>
                            External Services (${dappspec.auxiliary.length})
                        </div>
                        <div class="dappspec-motivation">
                            <ul>
                                ${dappspec.auxiliary.map(service => `<li><code>${service}</code></li>`).join('')}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    html += `</div>`;
    return html;
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
                                                <span class="url-label">URL${detail.urls.length > 1 ? 's' : ''}:</span>
                                                <span class="url-value">
                                                    ${Array.isArray(detail.urls) ? (
                                                        detail.urls.length === 0 ? '⚠️ Any url could be used' :
                                                        `<ul class="url-list">
                                                            ${detail.urls.map((url: string) => `<li><code>${url}</code></li>`).join('')}
                                                        </ul>`
                                                    ) : (
                                                        detail.url ? detail.url : '<any>'
                                                    )}
                                                </span>
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
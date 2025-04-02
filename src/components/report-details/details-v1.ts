import { formatFileSize } from '../../report-renderer';
import './styles.css';

// Function to render detailed report information
export function renderReportDetails(report: any): string {
    let html = '';
    
    html += `
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
    html += `
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
            </div>
        </div>
    `;
    
    html += `
        <h3>Distribution Purity</h3>
        <div class="report-section">
            ${renderDistributionPurity(report.distributionPurity)}
        </div>
        
        <h3>Networking Purity</h3>
        <div class="report-section">
            ${renderNetworkingPurity(report.networkingPurity)}
        </div>
        
        <h3>Web3 Interactions</h3>
        <div class="report-section">
            ${renderWeb3Interactions(report.web3)}
        </div>
    `;
    
    return html;
}

// Generic function to render a list of items grouped by file
export function renderGroupedItems(items: any[], itemType: string, extractFile: (item: any) => string, extractDetails: (item: any) => any[]): string {
    let html = '';
    
    if (items && items.length > 0) {
        html += `<h4>${itemType} (${items.length})</h4>`;
        
        // Group items by file
        const itemsByFile: Record<string, any[]> = {};
        
        items.forEach(item => {
            const file = extractFile(item);
            
            if (!itemsByFile[file]) {
                itemsByFile[file] = [];
            }
            
            const details = extractDetails(item);
            itemsByFile[file].push(...details);
        });
        
        html += `<ul class="report-list">`;
        Object.keys(itemsByFile).forEach(file => {
            html += `<li>
                    <div>${file}</div>
                    <ul class="report-sublist">`;
            itemsByFile[file].forEach(detail => {
                if (typeof detail === 'string') {
                    html += `<li>${detail}</li>`;
                } else if (detail.type && detail.url) {
                    html += `<li>${detail.type}: ${detail.url}</li>`;
                } else {
                    html += `<li>${JSON.stringify(detail)}</li>`;
                }
            });
            html += `</ul>
                    </li>`;
        });
        html += `</ul>`;
    } else {
        html += `<h4>${itemType}</h4>
                <p>No ${itemType.toLowerCase()} detected.</p>`;
    }
    
    return html;
}

// Function to render distribution purity section
export function renderDistributionPurity(purity: any): string {
    let html = '';
    
    // Render external scripts
    html += renderGroupedItems(
        purity.externalScripts || [],
        'External Scripts',
        (script) => script.file || 'index.html',
        (script) => script.offenders || []
    );
    
    // Render external media
    html += renderGroupedItems(
        purity.externalMedia || [],
        'External Media',
        (media) => media.file || 'index.html',
        (media) => media.offenders || []
    );
    
    return html;
}

// Function to render networking purity section
export function renderNetworkingPurity(purity: any): string {
    let html = '';
    
    // Render HTTP requests
    html += renderGroupedItems(
        purity.http || [],
        'HTTP Requests',
        (item) => item.file || 'index.html',
        (item) => item.offenders.map((url: string) => ({ type: 'http', url }))
    );
    
    // Render WebSocket connections
    html += renderGroupedItems(
        purity.websocket || [],
        'WebSocket Connections',
        (item) => item.file || 'index.html',
        (item) => item.offenders.map((url: string) => ({ type: 'websocket', url }))
    );
    
    // Render WebRTC connections
    html += renderGroupedItems(
        purity.webrtc || [],
        'WebRTC Connections',
        (item) => item.file || 'unknown',
        (item) => item.offenders.reduce((acc: any[], offender: any) => {
            if (!acc.some((o: any) => o.url === offender.url)) {
                acc.push(offender);
            }
            return acc;
        }, [])
    );
    
    return html;
}

// Function to render web3 interactions section
export function renderWeb3Interactions(web3: any[]): string {
    if (!web3 || web3.length === 0) {
        return '<p>No Web3 interactions detected.</p>';
    }
    
    return renderGroupedItems(
        web3,
        'Web3 Interactions',
        (item) => item.file || 'index.html',
        (item) => item.offenders.map((offender: any) => ({
            type: offender.service,
            url: offender.url,
            risk: offender.risk
        }))
    );
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
    if (!purity) return '<p>No networking information available.</p>';
    
    const httpRequests = purity.http || [];
    const wsConnections = purity.websocket || [];
    const webrtcConnections = purity.webrtc || [];
    
    if (httpRequests.length === 0 && wsConnections.length === 0 && webrtcConnections.length === 0) {
        return '<p>✅ No outbound network requests detected. The dapp does not communicate with external services.</p>';
    }
    
    let html = '';
    
    if (httpRequests.length > 0) {
        html += `<p>🌐 HTTP requests detected (${httpRequests.length})</p>`;
    }
    
    if (wsConnections.length > 0) {
        html += `<p>🔌 WebSocket connections detected (${wsConnections.length})</p>`;
    }
    
    if (webrtcConnections.length > 0) {
        html += `<p>📡 WebRTC connections detected (${webrtcConnections.length})</p>`;
    }
    
    return html;
}

// Helper function to render web3 information in a readable format
export function renderWeb3Info(web3: any[]): string {
    if (!web3 || web3.length === 0) {
        return '<p>❌ No Web3 interactions detected. This dapp does not interact with any blockchain.</p>';
    }
    
    // Count total interactions
    const totalInteractions = web3.reduce((total, item) => {
        return total + (item.offenders ? item.offenders.length : 0);
    }, 0);
    
    return `<p>🧩 ${totalInteractions} Web3 interactions detected. This dapp utilizes blockchain functionality.</p>`;
}

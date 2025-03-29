import { isContentHashOutdated, getCurrentContentHash } from './ens-resolver';

// Function to render detailed report information
export function renderReportDetails(report: any): string {
    let html = '';
    
    html += `
            <div class="report-item">
                <span class="report-label">Content Hash:</span>
                <span class="report-value" id="content-hash-warning">
                    <span>${report.contentHash}</span>
                    <a href="https://webui.ipfs.io/#/ipfs/${report.contentHash}" target="_blank" class="hash-link" title="Inspect IPFS Content">
                        <span class="hash-icon">🔍</span>
                    </a>
                    <button class="copy-hash-btn" title="Copy hash" onclick="navigator.clipboard.writeText('${report.contentHash}').then(() => { this.classList.add('copied'); setTimeout(() => this.classList.remove('copied'), 2000); })">
                        <span class="hash-icon">📋</span>
                    </button>
                </span>
            </div>
    `;
    html += `
        <div class="report-info">
            <div class="report-item">
                <span class="report-label">Total Size:</span>
                <span class="report-value">${formatFileSize(report.totalSize)}</span>
            </div>
            <div class="report-item">
                <span class="report-label">Created at:</span>
                <span class="report-value">${new Date(report.timestamp * 1000).toISOString().replace('T', ' ').split('.')[0]}</span>
            </div>
            <div class="report-item">
                <span class="report-label">Block number:</span>
                <span class="report-value">${report.blockNumber}</span>
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

// Function to render the dapp details page
export function renderDappDetailsPage(
    ensName: string, 
    dappData: any, 
    container: HTMLElement, 
    createRiskChart: (dappData: any, showEnlarged?: boolean) => Promise<HTMLElement>,
    calculateCensorshipResistanceScore: (dappData: any) => number,
    getScoreCategory: (score: number) => string,
    getCategoryColor: (category: string) => string
) {
    // Calculate censorship resistance score
    const score = calculateCensorshipResistanceScore(dappData);
    const scoreCategory = getScoreCategory(score);
    
    // Create the details page HTML
    const title = dappData.report.title || ensName;
    const category = dappData.metadata?.category || 'other';
    
    let html = `
        <div class="dapp-details">
            <div class="dapp-details-header">
                <div class="dapp-icon-title">
                    ${dappData.favicon ? 
                        `<img src="${dappData.favicon}" alt="${title} icon" class="dapp-icon">` : 
                        `<img src="./images/default-icon.png" alt="Default icon" class="dapp-icon">`}
                    <h1>${title}</h1>
                </div>
                <div class="dapp-header-right">
                    <span class="category-label ${getCategoryColor(category)}">${category}</span>
                    <div class="score-badge score-${scoreCategory}" title="Dapp Rank Score: ${scoreCategory.toUpperCase()}">${score}</div>
                </div>
            </div>
            <div class="dapp-details-content">
                <!-- Content hash warning banner - hidden by default -->
                <div id="content-hash-warning-banner" class="warning-banner" style="display: none; background-color: var(--warning-background); border-left: 4px solid var(--warning-color); padding: 12px 15px; margin-bottom: 20px; border-radius: 4px; align-items: center; color: var(--warning-text-color);">
                    <span style="font-size: 20px; margin-right: 10px;">⚠️</span>
                    <div>
                        <strong>Outdated Content Hash</strong>
                        <p style="margin: 5px 0 0 0;">This report was generated using an older version of the dapp. The ENS record points to a newer version. The data shown may not reflect the current state of the dapp.</p>
                    </div>
                </div>
                
                <div class="dapp-details-section">
                    <h2>Mirrors</h2>
                    <div class="dapp-mirrors">
                        <a href="https://${ensName}.link" target="_blank" class="mirror-link">
                            <span class="link-icon">🔗</span> ${ensName}.link
                        </a>
                        <a href="https://${ensName}.limo" target="_blank" class="mirror-link">
                            <span class="link-icon">🔗</span> ${ensName}.limo
                        </a>
                        <a href="https://${ensName}.ac" target="_blank" class="mirror-link">
                            <span class="link-icon">🔗</span> ${ensName}.ac
                        </a>
                        <a href="https://${ensName}.sucks" target="_blank" class="mirror-link">
                            <span class="link-icon">🔗</span> ${ensName}.sucks
                        </a>
                        <a href="https://${ensName.slice(0, -4)}-eth.ipns.dweb.link" target="_blank" class="mirror-link">
                            <span class="link-icon">🔗</span> ${ensName.slice(0, -4)}-eth.ipns.dweb.link
                        </a>
                        <a href="https://${ensName.slice(0, -4)}-eth.ipns.inbrowser.link" target="_blank" class="mirror-link">
                            <span class="link-icon">🔗</span> ${ensName.slice(0, -4)}-eth.ipns.inbrowser.link
                        </a>
                    </div>
                </div>
                
                <div class="dapp-details-section">
                    <h2>Overview</h2>
                    <div class="dapp-risk-chart" id="dapp-risk-chart">
                        <!-- Risk triangle will be inserted here by JS -->
                    </div>
                    <div class="risk-information-container" id="risk-information">
                        <!-- Distribution, networking, and web3 info will be added here -->
                    </div>
                </div>
                
                <div class="dapp-details-section">
                    <h2>Report Details</h2>
                    <div class="dapp-report">
                        ${renderReportDetails(dappData.report)}
                    </div>
                </div>

            </div>
        </div>
    `;
    
    container.innerHTML = html;
    
    // Create the risk chart in the designated container
    const chartContainer = document.getElementById('dapp-risk-chart');
    if (chartContainer) {
        createRiskChart(dappData, true).then(chart => {
            chartContainer.appendChild(chart);
        });
    }
    
    // Add the distribution, networking and web3 information
    const riskInfoContainer = document.getElementById('risk-information');
    if (riskInfoContainer) {
        // Distribution info
        const distributionInfo = document.createElement('div');
        distributionInfo.className = 'distribution-info';
        distributionInfo.innerHTML = `
            <h3>Distribution</h3>
            ${renderDistributionInfo(dappData.report.distributionPurity)}
        `;
        
        // Networking info
        const networkingInfo = document.createElement('div');
        networkingInfo.className = 'networking-info';
        networkingInfo.innerHTML = `
            <h3>Networking</h3>
            ${renderNetworkingInfo(dappData.report.networkingPurity)}
        `;
        
        // Web3 info
        const web3Info = document.createElement('div');
        web3Info.className = 'web3-info';
        web3Info.innerHTML = `
            <h3>Web3</h3>
            ${renderWeb3Info(dappData.report.web3)}
        `;
        
        // Add all info sections
        riskInfoContainer.appendChild(distributionInfo);
        riskInfoContainer.appendChild(networkingInfo);
        riskInfoContainer.appendChild(web3Info);
    }
    
    // Check if contentHash is outdated and add warning icon if needed
    if (dappData.report.contentHash) {
        // First, get the current content hash to compare with the report's hash
        const getCurrentHash = async () => {
            try {
                const currentContentHash = await getCurrentContentHash(ensName);
                const isOutdated = currentContentHash && currentContentHash !== dappData.report.contentHash;
                
                if (isOutdated && currentContentHash) {
                    // Show the warning banner at the top of the page with the current hash
                    const warningBanner = document.getElementById('content-hash-warning-banner');
                    if (warningBanner) {
                        // Find the paragraph element to update
                        const paragraph = warningBanner.querySelector('p');
                        if (paragraph) {
                            paragraph.innerHTML = `This report was generated using an older version of the dapp. The ENS record points to a newer version. The data shown may not reflect the current state of the dapp.<br><br><strong>Current content hash:</strong><br /> <span style="font-family: var(--font-monospace); word-break: break-all; font-size: 0.85rem; background-color: rgba(0,0,0,0.05); padding: 3px 6px; border-radius: 3px; display: inline-block; margin-top: 3px;">${currentContentHash}</span>`;
                        }
                        warningBanner.style.display = 'flex';
                    }
                    
                    // Also add the warning icon next to the content hash as before
                    const warningContainer = document.createElement('span');
                    warningContainer.className = 'tooltip warning-icon';
                    warningContainer.textContent = '⚠️';
                    
                    const tooltip = document.createElement('span');
                    tooltip.className = 'tooltip-text';
                    tooltip.textContent = 'Content hash is outdated. The ENS record points to a newer version.';
                    warningContainer.appendChild(tooltip);
                    
                    const warningElement = document.getElementById('content-hash-warning');
                    if (warningElement) {
                        warningElement.appendChild(warningContainer);
                    }
                }
            } catch (error) {
                console.error(`Error checking contentHash for ${ensName}:`, error);
            }
        };
        
        // Execute the async function
        getCurrentHash();
    }
}

// Helper function to format file size
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Generic function to render a list of items grouped by file
function renderGroupedItems(items: any[], itemType: string, extractFile: (item: any) => string, extractDetails: (item: any) => any[]): string {
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
function renderDistributionInfo(purity: any): string {
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
function renderNetworkingInfo(purity: any): string {
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
function renderWeb3Info(web3: any[]): string {
    if (!web3 || web3.length === 0) {
        return '<p>❌ No Web3 interactions detected. This dapp does not interact with any blockchain.</p>';
    }
    
    // Count total interactions
    const totalInteractions = web3.reduce((total, item) => {
        return total + (item.offenders ? item.offenders.length : 0);
    }, 0);
    
    return `<p>🧩 ${totalInteractions} Web3 interactions detected. This dapp utilizes blockchain functionality.</p>`;
} 
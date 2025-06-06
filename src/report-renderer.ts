import { isContentHashOutdated, getCurrentContentHash } from './ens-resolver';
import { fetchCar, getJson } from './ipfs-utils';
import { renderReportDetails as renderV1ReportDetails } from './components/report-details/details-v1';
import { renderReportDetails as renderV2ReportDetails } from './components/report-details/details-v2';
import { renderOutdatedWarning } from './components/report-details/details-outdated';
import { DappData, DappMetadata, calculateCensorshipResistanceScore, getScoreCategory, generateSummarizedReport } from './reports';
import { createRiskChart } from './pie-chart';
import { renderInfoCard } from './components/ui/info-card';
import { renderInfoItems } from './components/ui/info-items';

// Helper function to get an appropriate icon based on MIME type
export function getMimeTypeIcon(mimeType: string | null | undefined): string {
    if (!mimeType) {
        return './images/icons/default.png';
    } else if (mimeType === 'inode/directory') {
        return './images/icons/default.png';
    } else if (mimeType.startsWith('text/html')) {
        return './images/icons/html.png';
    } else if (mimeType.startsWith('image/jpeg')) {
        return './images/icons/jpg.png';
    } else if (mimeType.startsWith('image/png')) {
        return './images/icons/png.png';
    } else if (mimeType.startsWith('application/pdf')) {
        return './images/icons/pdf.png';
    } else if (mimeType.startsWith('application/json')) {
        return './images/icons/json.png';
    } else if (mimeType.startsWith('application/xml') || 
               mimeType.startsWith('text/xml')) {
        return './images/icons/xml.png';
    } else if (mimeType.startsWith('text/csv')) {
        return './images/icons/csv.png';
    } else if (mimeType.includes('zip') || 
               mimeType.includes('compressed')) {
        return './images/icons/zip.png';
    } else if (mimeType.includes('document') || 
               mimeType.includes('msword') ||
               mimeType.includes('officedocument')) {
        return './images/icons/doc.png';
    } else {
        return './images/icons/file.png';
    }
}

// Function to fetch dappspec.json from the archive car file
async function fetchDappspecJson(fs: any, root: any, blockNumber: string | number): Promise<any | null> {
    try {
        const dappspec = await getJson(fs, root, `${blockNumber}/dappspec.json`);
        console.log(`Found dappspec.json for block ${blockNumber}:`, dappspec);
        return dappspec;
    } catch (error) {
        console.log(`No dappspec.json found for block ${blockNumber}`);
        return null;
    }
}

// Function to render detailed report information based on version
export function renderReportDetails(report: any): string {
    // Use the appropriate renderer based on report version
    if (report.version === 2) {
        return renderV2ReportDetails(report);
    }
    // Default to v1 renderer
    return renderV1ReportDetails(report);
}

// Interface for historical report data
interface HistoricalReport {
    timestamp: number;
    blockNumber: number;
    report: any;
    dappspec: any;
    isLatest: boolean;
}

// Interface for archive data
export interface ArchiveData {
    latestDappData: DappData;
    historicalReports: HistoricalReport[];
}

// Function to render the dapp details page
export function renderDappDetailsPage(
    ensName: string, 
    container: HTMLElement, 
    getCategoryColor: (category: string) => string
) {
    // Show loading state
    container.innerHTML = '<div class="loading">Loading dapp details...</div>';
    
    // Load all data (latest dapp data and historical reports) in one call
    loadHistoricalReports(ensName).then(archiveData => {
        const dappData = archiveData.latestDappData;
        
        renderDappDetailsPageWithHistory(
            ensName,
            dappData,
            container,
            getCategoryColor,
            archiveData.historicalReports
        );
    }).catch(error => {
        console.error('Error loading data for dapp details:', error);
        // Show error message
        container.innerHTML = `<div class="error">Error loading dapp details: ${error.message}</div>`;
    });
}

// Function to load all historical reports and latest dapp data for an ENS name
export async function loadHistoricalReports(ensName: string, currentBlockNumber?: number): Promise<ArchiveData> {
    try {
        // Fetch archive directory listing
        const { fs, root } = await fetchCar(`/dapps/archive/${ensName}/`);
        
        // Get list of block numbers (directories) in the archive
        const blockNumbers: number[] = [];
        try {
            for await (const entry of fs.ls(root)) {
                if (!entry.name) continue;
                // Try to parse the directory name as a block number
                const blockNumber = parseInt(entry.name, 10);
                if (!isNaN(blockNumber)) {
                    blockNumbers.push(blockNumber);
                }
            }
        } catch (error) {
            console.error(`Error listing archive for ${ensName}:`, error);
            throw new Error(`Failed to list archive: ${error.message}`);
        }
        
        // Sort block numbers in descending order (newest first)
        blockNumbers.sort((a, b) => b - a);
        
        if (blockNumbers.length === 0) {
            throw new Error(`No reports found for ${ensName}`);
        }
        
        // The latest block number is the first one in the sorted array
        const latestBlockNumber = blockNumbers[0];
        
        // If currentBlockNumber is not provided, use the latest one
        currentBlockNumber = currentBlockNumber || latestBlockNumber;
        
        // Load the latest report data
        const latestReport = await getJson(fs, root, `${latestBlockNumber}/report.json`);
        
        // Try to fetch dappspec.json if it exists
        const dappspec = await fetchDappspecJson(fs, root, latestBlockNumber);
        
        // Load metadata from the archive directory which should have the definitive metadata
        let latestMetadata: DappMetadata = await getJson(fs, root, 'metadata.json');
        
        // Construct the favicon URL for the latest report
        let faviconUrl = '';
        if (latestReport.favicon) {
            faviconUrl = `./dapps/archive/${ensName}/${latestBlockNumber}/${latestReport.favicon}`;
        } else {
            // Select icon based on rootMimeType
            faviconUrl = getMimeTypeIcon(latestReport.rootMimeType);
        }
            
        // Create the latest dapp data object
        const latestDappData = {
            metadata: latestMetadata,
            report: latestReport,
            favicon: faviconUrl,
            dappspec: dappspec
        };
        
        // Log the category for debugging
        console.log(`Dapp ${ensName} category from metadata:`, latestMetadata.category || 'not found');
        
        // Load report data for each block number for historical reports
        const historicalReports: HistoricalReport[] = [];
        
        for (const blockNumber of blockNumbers) {
            try {
                // Get the report.json for this block number
                const reportData = await getJson(fs, root, `${blockNumber}/report.json`);
                
                // Try to fetch dappspec.json for this block if it exists
                const blockDappspec = await fetchDappspecJson(fs, root, blockNumber);
                
                // Add to the list of reports
                historicalReports.push({
                    timestamp: reportData.timestamp,
                    blockNumber: blockNumber,
                    report: reportData,
                    dappspec: blockDappspec,
                    isLatest: blockNumber === currentBlockNumber
                });
            } catch (error) {
                console.error(`Error loading report for ${ensName} at block ${blockNumber}:`, error);
                // Continue with other block numbers
            }
        }
        
        return {
            latestDappData,
            historicalReports
        };
    } catch (error) {
        console.error(`Error loading data for ${ensName}:`, error);
        throw error;
    }
}

// Function to render the dapp details page with historical reports
function renderDappDetailsPageWithHistory(
    ensName: string, 
    dappData: DappData, 
    container: HTMLElement, 
    getCategoryColor: (category: string) => string,
    historicalReports: HistoricalReport[]
) {
    // Calculate censorship resistance score
    const score = calculateCensorshipResistanceScore(dappData);
    const scoreCategory = getScoreCategory(score);
    
    // Create the details page HTML
    const title = dappData.report.title || ensName;
    
    // Get the category from metadata with debug logging
    const category = dappData.metadata?.category || 'other';
    console.log(`[${ensName}] Using category: "${category}"`);
    
    let html = `
        <div class="dapp-details">
            <div class="dapp-details-header">
                <div class="dapp-icon-title">
                    ${dappData.favicon ? 
                        `<img src="${dappData.favicon}" alt="${title} icon" class="dapp-icon">` : 
                        `<img src="${getMimeTypeIcon(dappData.report.rootMimeType)}" alt="${dappData.report.rootMimeType || 'Default'} icon" class="dapp-icon">`}
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
                        <!-- Distribution, networking, and dappspec information will be inserted here -->
                    </div>
                </div>
                
                <div class="dapp-details-section">
                    <h2>Report Details</h2>
                    <div class="dapp-report-history" id="dapp-report-history">
                        <!-- The report history will be loaded here -->
                        <p>Loading report history...</p>
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
    
    // Add the distribution, networking and dappspec information
    const riskInfoContainer = document.getElementById('risk-information');
    if (riskInfoContainer) {
        // Clear previous content
        riskInfoContainer.innerHTML = '';
        
        // Create and add each info card
        const cards = [
            {
                title: 'Dappspec',
                content: renderDappspecInfo(dappData)
            },
            {
                title: 'Distribution',
                content: renderDistributionInfo(dappData)
            },
            {
                title: 'Networking',
                content: renderNetworkingInfo(dappData)
            }
        ];
        
        cards.forEach(card => {
            const cardHtml = renderInfoCard(card);
            riskInfoContainer.innerHTML += cardHtml;
        });
    }
    

    const reportHistoryContainer = document.getElementById('dapp-report-history');
    if (reportHistoryContainer) {
        reportHistoryContainer.innerHTML = renderReportHistory(historicalReports, null);
        // Set up event listeners for report toggles
        setupReportToggleListeners();
    }
    // Get the current content hash and update the report history
    getCurrentContentHash(ensName).then(currentContentHash => {
        console.log('ens resolved')
        // Update the report history with the current content hash
        const reportHistoryContainer = document.getElementById('dapp-report-history');
        if (reportHistoryContainer) {
            reportHistoryContainer.innerHTML = renderReportHistory(historicalReports, currentContentHash);
            // Set up event listeners for report toggles
            setupReportToggleListeners();
        }
        
        // Check if contentHash is outdated and show warning banner if needed
        if (currentContentHash && dappData.report.contentHash && currentContentHash !== dappData.report.contentHash) {
            const warningBanner = document.getElementById('content-hash-warning-banner');
            if (warningBanner) {
                // Find the paragraph element to update
                const paragraph = warningBanner.querySelector('p');
                if (paragraph) {
                    paragraph.innerHTML = `This report was generated using an older version of the dapp. The ENS record points to a newer version. The data shown may not reflect the current state of the dapp.<br><br><strong>Current content hash:</strong><br /> <span style="font-family: var(--font-monospace); word-break: break-all; font-size: 0.85rem; background-color: rgba(0,0,0,0.05); padding: 3px 6px; border-radius: 3px; display: inline-block; margin-top: 3px;">${currentContentHash}</span>`;
                }
                warningBanner.style.display = 'flex';
            }
        }
    }).catch(error => {
        console.error(`Error getting current content hash for ${ensName}:`, error);
        console.log('ens not resolved')
        
        // Still render the report history without the current content hash
    });
}

// Function to render the report history section
function renderReportHistory(reports: HistoricalReport[], currentContentHash: string | null): string {
    if (!reports || reports.length === 0) {
        return '<p>No historical reports available.</p>';
    }

    let html = `
        <div class="report-history-container">
    `;

    // Sort reports by timestamp, newest first
    const sortedReports = [...reports].sort((a, b) => b.timestamp - a.timestamp);
    
    // Get the most recent report's content hash
    const latestReportContentHash = sortedReports[0]?.report.contentHash;
    
    // Add warning for outdated content hash
    if (currentContentHash && latestReportContentHash && currentContentHash !== latestReportContentHash) {
        html += renderOutdatedWarning(currentContentHash, latestReportContentHash);
    }

    sortedReports.forEach((report, index) => {
        const date = new Date(report.timestamp * 1000);
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
        const isContentHashMatch = currentContentHash && report.report.contentHash === currentContentHash;

        // Create a unique ID for each report section
        const reportId = `report-${report.blockNumber}`;
        
        // Set first report to be expanded by default
        const isFirstReport = index === 0;
        const displayStyle = isFirstReport ? 'block' : 'none';
        const toggleIcon = isFirstReport ? '▲' : '▼';
        
        html += `
            <div class="report-history-item">
                <div class="report-history-header" data-report-id="${reportId}">
                    <div class="report-history-title">
                        <span class="report-date">${formattedDate}</span>
                        <span class="report-block">Block #${report.blockNumber}</span>
                        ${isContentHashMatch ? '<span class="report-current-badge">Current ENS Record</span>' : ''}
                    </div>
                    <div class="report-toggle-icon">${toggleIcon}</div>
                </div>
                <div class="report-history-content" id="${reportId}" style="display: ${displayStyle};">
                    ${renderReportDetails({...report.report, dappspec: report.dappspec})}
                </div>
            </div>
        `;
    });

    html += `</div>`;
    
    return html;
}

// Function to set up event listeners for report toggle buttons
function setupReportToggleListeners() {
    document.querySelectorAll('.report-history-header').forEach(header => {
        header.addEventListener('click', () => {
            const reportId = header.getAttribute('data-report-id');
            const contentSection = document.getElementById(reportId);
            const toggleIcon = header.querySelector('.report-toggle-icon');
            
            if (contentSection) {
                // Toggle display
                if (contentSection.style.display === 'none') {
                    contentSection.style.display = 'block';
                    if (toggleIcon) toggleIcon.textContent = '▲';
                } else {
                    contentSection.style.display = 'none';
                    if (toggleIcon) toggleIcon.textContent = '▼';
                }
            }
        });
    });
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

// Helper function to render dappspec information in a readable format
function renderDappspecInfo(dappData: DappData): string {
    const report = generateSummarizedReport(dappData);
    if (!report) return '<p>No dappspec information available.</p>';
    
    const items = [
        {
            icon: '📝',
            title: 'Manifest',
            details: [{
                title: '',
                content: report.dappspec.hasDappspec ? 'A Dappspec manifest was detected' : 'No Dappspec manifest detected'
            }]
        },
        {
            icon: '🔁',
            title: 'Fallbacks',
            details: [{
                title: '',
                content: report.dappspec.fallbacks > 0 
                    ? `Alternative endpoints and gateways: ${report.dappspec.fallbacks}`
                    : 'No fallback endpoints detected'
            }]
        },
        {
            icon: '⛓️',
            title: 'Blockchains',
            details: [{
                title: '',
                content: report.dappspec.blockchains > 0 
                    ? `Supported blockchain networks: ${report.dappspec.blockchains}`
                    : 'No blockchain networks declared'
            }]
        }
    ];
    
    return renderInfoItems(items);
}

function renderDistributionInfo(dappData: DappData): string {
    const report = generateSummarizedReport(dappData);
    if (!report) return '<p>No distribution information available.</p>';
    
    const items = [
        {
            icon: '🎬',
            title: 'External Media',
            details: [{
                title: '',
                content: report.distribution.externalMedia > 0 
                    ? `External media resources loaded from outside the dapp's content: ${report.distribution.externalMedia}`
                    : 'No external media detected'
            }]
        },
        {
            icon: '📜',
            title: 'External Scripts',
            details: [{
                title: '',
                content: report.distribution.externalScripts > 0 
                    ? `JavaScript code loaded from external sources: ${report.distribution.externalScripts}`
                    : 'No external scripts detected'
            }]
        }
    ];
    
    return renderInfoItems(items);
}

function renderNetworkingInfo(dappData: DappData): string {
    const report = generateSummarizedReport(dappData);
    if (!report) return '<p>No networking information available.</p>';
    
    const items = [
        {
            icon: '⚡',
            title: 'RPC',
            details: [{
                title: '',
                content: report.networking.rpc > 0 
                    ? `Ethereum RPC endpoint connections: ${report.networking.rpc}`
                    : 'No RPC connections detected'
            }]
        },
        {
            icon: '📦',
            title: 'Bundler',
            details: [{
                title: '',
                content: report.networking.bundler > 0 
                    ? `Account abstraction bundler connections: ${report.networking.bundler}`
                    : 'No bundler connections detected'
            }]
        },
        {
            icon: '🔒',
            title: 'Self',
            details: [{
                title: '',
                content: report.networking.self > 0 
                    ? `Self-hosted backend services: ${report.networking.self}`
                    : 'No self-hosted services detected'
            }]
        },
        {
            icon: '📡',
            title: 'Auxiliary',
            details: [{
                title: '',
                content: report.networking.auxiliary > 0 
                    ? `Additional third-party service connections: ${report.networking.auxiliary}`
                    : 'No auxiliary services detected'
            }]
        }
    ];
    
    return renderInfoItems(items);
} 
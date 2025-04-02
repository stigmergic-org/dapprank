import './styles.css';

/**
 * Renders a warning entry for outdated content hash in the report history
 * @param currentContentHash The current content hash from ENS
 * @param reportContentHash The content hash from the report
 * @returns HTML string for the outdated warning entry
 */
export function renderOutdatedWarning(currentContentHash: string, reportContentHash: string): string {
    const today = new Date();
    const formattedDate = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(today);

    // Create a unique ID for this warning section
    const warningId = `outdated-warning-${Date.now()}`;
    
    return `
        <div class="report-history-item report-outdated-warning">
            <div class="report-history-header" data-report-id="${warningId}">
                <div class="report-history-title">
                    <span class="report-date">${formattedDate}</span>
                    <span class="report-warning-badge">New Version Detected</span>
                </div>
                <div class="report-toggle-icon">▼</div>
            </div>
            <div class="report-history-content" id="${warningId}" style="display: none;">
                <div class="report-warning-content">
                    <p>
                        <strong>Warning:</strong> Dapp Rank doesn't have any report for this version of the dapp yet.
                        The reports on this page were generated for an older version of the dapp and may not reflect its current state.
                    </p>
                <div class="report-hash-comparison">
                    <div class="report-hash-item">
                        <strong>Current Content Hash (ENS):</strong>
                        <span class="report-hash-value">
                            <span class="item-icon">🔐</span>${currentContentHash}
                        </span>
                        <div class="hash-button-container">
                            <button class="hash-link" title="Inspect IPFS Content" onclick="window.open('https://webui.ipfs.io/#/ipfs/${currentContentHash}', '_blank')">
                                <span class="hash-icon">🔍</span> Explore IPFS
                            </button>
                            <button class="copy-hash-btn" title="Copy to clipboard" onclick="navigator.clipboard.writeText('${currentContentHash}').then(() => { this.classList.add('copied'); setTimeout(() => this.classList.remove('copied'), 2000); })">
                                <span class="hash-icon">📋</span> Copy Hash
                            </button>
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
    `;
} 
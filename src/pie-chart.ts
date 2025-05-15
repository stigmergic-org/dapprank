import { generateSummarizedReport, SummarizedReport } from "./reports";

import { CID } from 'multiformats/cid';

export async function createRiskChart(dappData?: any, showEnlarged: boolean = false): Promise<HTMLDivElement> {
    const report = dappData ? generateSummarizedReport(dappData) : null;
    const pieColors = getPieColors(report);
    const reportContent = renderReportText(report);
    
    if (showEnlarged) {
        return createEnlargedPieChart(dappData.report.contentHash, pieColors, reportContent);
    } else {
        return createThreePiecePieChart(dappData.report.contentHash, pieColors, reportContent);
    }
}

function renderReportText(report: SummarizedReport) {
    const container = document.createElement('div');

    if (report) {
        // Distribution section with only title and emoji subtexts
        const distributionContainer = createSectionContainer(container, 'Distribution', '');
        const distSubtextsContainer = createHorizontalContainer(distributionContainer);
        addEmojiSubText(distSubtextsContainer, '🎬', 'media', report.distribution.externalMedia);
        addEmojiSubText(distSubtextsContainer, '📜', 'scripts', report.distribution.externalScripts);

        // Networking section with only title and emoji subtexts
        const networkingContainer = createSectionContainer(container, 'Networking', '');
        const netSubtextsContainer = createHorizontalContainer(networkingContainer);
        addEmojiSubText(netSubtextsContainer, '🌐', 'rpc', report.networking.rpc);
        addEmojiSubText(netSubtextsContainer, '🔌', 'bundler', report.networking.bundler);
        addEmojiSubText(netSubtextsContainer, '🔄', 'self', report.networking.self);
        addEmojiSubText(netSubtextsContainer, '📡', 'auxiliary', report.networking.auxiliary);

        // Dappspec section with total number
        const dappspecContainer = createSectionContainer(container, 'Dappspec', '');
        const dappspecSubtextsContainer = createHorizontalContainer(dappspecContainer);
        addEmojiSubText(dappspecSubtextsContainer, '📋', 'manifest', report.dappspec.hasDappspec ? 1 : 0);
        addEmojiSubText(dappspecSubtextsContainer, '🔄', 'fallbacks', report.dappspec.fallbacks);
        addEmojiSubText(dappspecSubtextsContainer, '⛓️', 'blockchains', report.dappspec.blockchains);
    } else {
        createSectionContainer(container, 'Distribution', 'No report available');
        createSectionContainer(container, 'Networking', 'No report available');
        createSectionContainer(container, 'Dappspec', 'No report available');
    }

    return container;
}

function createSectionContainer(parent: HTMLElement, headerText: string, textContent: string): HTMLElement {
    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'report-container';
    parent.appendChild(sectionContainer);

    const header = document.createElement('div');
    header.className = 'report-header';
    header.textContent = headerText;
    sectionContainer.appendChild(header);

    const text = document.createElement('div');
    text.className = 'report-text';
    text.textContent = textContent;
    sectionContainer.appendChild(text);

    return sectionContainer;
}

// Helper function to create a horizontal container for subtexts
function createHorizontalContainer(parent: HTMLElement): HTMLElement {
    const container = document.createElement('div');
    container.className = 'horizontal-subtexts';
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.gap = '1em';
    container.style.flexWrap = 'wrap';
    parent.appendChild(container);
    return container;
}

// New function to add emoji subtexts with hover tooltips
function addEmojiSubText(container: HTMLElement, emoji: string, tooltip: string, value: number): void {
    const subText = document.createElement('div');
    subText.className = 'report-sub-text';
    subText.style.margin = '0.3em 0';
    
    // Create tooltip span with the emoji
    const emojiSpan = document.createElement('span');
    emojiSpan.textContent = emoji;
    emojiSpan.setAttribute('title', tooltip);
    emojiSpan.style.cursor = 'help';
    emojiSpan.style.position = 'relative';
    
    // Create value span
    const valueSpan = document.createElement('span');
    valueSpan.textContent = ` ${value}`;
    valueSpan.style.marginLeft = '0.3em';
    
    subText.appendChild(emojiSpan);
    subText.appendChild(valueSpan);
    container.appendChild(subText);
}

function getPieColors(report: SummarizedReport): string[] {
    const COLORS = {
        'red': '#FF6347', // Tomato
        'green': '#3CB371', // Medium Sea Green
        'yellow': '#FFD700', // Gold
        'gray': '#A9A9A9' // Dark Gray
    };
    if (!report) {
        return [COLORS.gray, COLORS.gray, COLORS.gray]
    }
    const colors = [];

    // Color for Networking Purity
    if (report.networking.rpc + report.networking.bundler + report.networking.self + report.networking.auxiliary > 0) {
        colors.push(COLORS.red);
    } else {
        colors.push(COLORS.green);
    }

    // Color for dappspec
    if (report.dappspec.hasDappspec) {
        if (report.dappspec.fallbacks > 0 || report.dappspec.blockchains > 0) {
            colors.push(COLORS.green);
        } else {
            colors.push(COLORS.yellow);
        }
    } else {
        colors.push(COLORS.red);
    }

    // Color for Distribution Purity
    if (report.distribution.externalScripts > 0) {
        colors.push(COLORS.red);
    } else if (report.distribution.externalMedia > 0) {
        colors.push(COLORS.yellow);
    } else {
        colors.push(COLORS.green);
    }

    return colors;
}

function createPieChartWithPieces(pieSize: number, colors: string[]) {
    const pieChart = document.createElement('div');
    pieChart.className = 'pie-chart';
    pieChart.style.position = 'relative';
    pieChart.style.width = `${pieSize}em`;
    pieChart.style.height = `${pieSize}em`;
    pieChart.style.overflow = 'hidden';
    pieChart.style.display = 'flex';
    pieChart.style.alignItems = 'center';
    pieChart.style.justifyContent = 'center';

    const angles = [120, 120, 120]; // 120 degrees each for three pieces
    let startAngle = -45;
    const lineWidth = pieSize / 25;
    
    // Use CSS variable for line color to support dark mode
    const lineColor = 'var(--pie-line-color, #fff)'; // Default to white if variable not set

    for (let i = 0; i < 3; i++) {
        const piece = document.createElement('div');
        piece.className = 'pie-piece';
        piece.style.position = 'absolute';
        piece.style.width = `100%`;
        piece.style.height = `100%`;
        piece.style.clipPath = `polygon(50% 50%, ${50 + 50 * Math.cos(Math.PI * startAngle / 180)}% ${50 + 50 * Math.sin(Math.PI * startAngle / 180)}%, ${50 + 50 * Math.cos(Math.PI * (startAngle + angles[i]) / 180)}% ${50 + 50 * Math.sin(Math.PI * (startAngle + angles[i]) / 180)}%)`;
        piece.style.backgroundColor = colors[i];
        piece.style.transform = `rotate(${startAngle}deg)`;
        piece.style.transformOrigin = '50% 50%';

        pieChart.appendChild(piece);

        startAngle += angles[i];
    }
    
    startAngle = 0
    for (let i = 0; i < 3; i++) {
        const line = document.createElement('div');
        line.className = 'pie-line';
        line.style.position = 'absolute';
        line.style.width = `${lineWidth}em`;
        line.style.height = `50%`;
        line.style.top = `0%`;
        line.style.backgroundColor = lineColor;
        line.style.transform = `rotate(${startAngle}deg)`;
        line.style.transformOrigin = '50% 100%'; // Adjust origin to left to center the line on the edge
        startAngle += angles[i];

        pieChart.appendChild(line);
    }
    return pieChart;
}

export function createEnlargedPieChart(siteRoot: CID, colors: string[], reportContent: HTMLDivElement) {
    const size = 8; // Larger size for the detailed view
    const container = document.createElement('div');
    container.className = 'enlarged-pie-container';
    
    const pieContainer = document.createElement('div');
    pieContainer.className = 'enlarged-pie-chart';
    
    const pieChart = createPieChartWithPieces(size, colors);
    pieContainer.appendChild(pieChart);
    
    // Add labels around the pieChart
    const labels = ['NETWORKING', 'DISTRIBUTION', 'DAPPSPEC'];
    const labelPositions = [
        { top: '30%', left: '48%', transform: 'rotate(60deg)' }, // networking
        { top: '77%', left: '19%', transform: 'rotate(0deg)' }, // distribution
        { top: '27%', left: '-1%', transform: 'rotate(-60deg)' }, // dappspec
    ];

    labels.forEach((text, index) => {
        const label = document.createElement('div');
        label.innerText = text;
        label.className = 'popup-label'; // Use class for styling
        label.style.position = 'absolute';
        label.style.fontWeight = 'bold';
        Object.assign(label.style, labelPositions[index]);
        pieChart.appendChild(label);
    });
    
    container.appendChild(pieContainer);
    
    return container;
}

export function createThreePiecePieChart(siteRoot: CID, colors: string[], reportContent: HTMLDivElement) {
    const size = 2
    const pieContainer = document.createElement('div');
    pieContainer.className = 'pie-container';
    pieContainer.style.position = 'relative';

    const pieChart = createPieChartWithPieces(size, colors); // Example usage with 80% piece size

    const popup = document.createElement('div');
    popup.className = 'popup'

    const popupPieContainer = document.createElement('div')
    popupPieContainer.className = 'popup-pie-container'
    popupPieContainer.style.marginRight = '1.2em'

    const popupPieChart = createPieChartWithPieces(size*4, colors)
    popupPieContainer.appendChild(popupPieChart)

    const popupText = document.createElement('div');
    popupText.appendChild(reportContent)
    popupText.style.display = 'inline-grid'
    popupPieChart.style.float = 'left'

    popup.appendChild(popupPieContainer);
    popup.appendChild(reportContent);

    // Add labels around the popupPieChart
    const popupLabels = ['NETWORKING', 'DISTRIBUTION', 'DAPPSPEC'];
    const labelPositions = [
        { top: '30%', left: '48%', transform: 'rotate(60deg)' }, // networking
        { top: '77%', left: '19%', transform: 'rotate(0deg)' }, // distribution
        { top: '27%', left: '-1%', transform: 'rotate(-60deg)' }, // dappspec
    ];

    popupLabels.forEach((text, index) => {
        const label = document.createElement('div');
        label.innerText = text;
        label.className = 'popup-label'; // Use class for styling
        Object.assign(label.style, labelPositions[index]);
        popupPieChart.appendChild(label);
    });

    // Enhanced event handling for better popup positioning
    let showPopupTimer: number | null = null;
    let hidePopupTimer: number | null = null;
    let isOverPieOrPopup = false;
    
    const handleMouseEnter = () => {
        isOverPieOrPopup = true;
        
        // Clear any pending hide timer
        if (hidePopupTimer) {
            clearTimeout(hidePopupTimer);
            hidePopupTimer = null;
        }
        
        // Hide any other active popups immediately
        hideAllPopups(popup);
        
        // Add a small delay before showing to avoid flickering on quick mouse movements
        if (!showPopupTimer && (popup.style.display !== 'flex' || popup.style.opacity !== '1')) {
            showPopupTimer = window.setTimeout(() => {
                showPopup();
                showPopupTimer = null;
            }, 70); // Slightly longer delay for better experience
        }
    };
    
    const handleMouseLeave = () => {
        isOverPieOrPopup = false;
        
        // Clear any pending show timer
        if (showPopupTimer) {
            clearTimeout(showPopupTimer);
            showPopupTimer = null;
        }
        
        // Set a timer to hide the popup to avoid flickering
        if (!hidePopupTimer) {
            hidePopupTimer = window.setTimeout(() => {
                if (!isOverPieOrPopup) {
                    hidePopup(popup);
                }
                hidePopupTimer = null;
            }, 200); // Longer delay before hiding
        }
    };
    
    // Function to handle showing the popup
    const showPopup = () => {
        // Make popup visible but transparent first to measure its dimensions
        popup.style.display = 'flex';
        popup.style.opacity = '0';
        
        // Get the position of the pie chart element to position the popup relative to it
        const pieRect = pieChart.getBoundingClientRect();
        const pieX = pieRect.left + (pieRect.width / 2);
        const pieY = pieRect.top + (pieRect.height / 2);
        
        // Position the popup based on the center of the pie chart, not the mouse
        const popupWidth = 25 * 16; // 25em in pixels (assuming 1em = 16px)
        
        // Need to wait a tiny bit for the browser to render the popup
        // so we can get its actual dimensions
        setTimeout(() => {
            // Get popup height after it's visible
            const popupHeight = popup.offsetHeight;
            
            // Calculate best position to avoid being cut off
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Standard offset from the pie chart
            const horizontalOffset = pieRect.width / 2 + 10; // Offset from center of pie
            
            // If popup would extend beyond right edge, position it to the left of the pie chart
            if (pieX + horizontalOffset + popupWidth > viewportWidth) {
                popup.style.right = (viewportWidth - pieX + horizontalOffset - pieRect.width) + 'px';
                popup.style.left = 'auto';
            } else {
                // Otherwise position to the right of the pie chart
                popup.style.left = (pieX + horizontalOffset) + 'px';
                popup.style.right = 'auto';
            }
            
            // Vertical positioning - Center with the pie chart center
            const safeMargin = 10;
            
            // Center the popup vertically with the pie chart center
            let topPosition = pieY - (popupHeight / 2);
            
            // If the popup would go off the top of the screen, position it at the top with a margin
            if (topPosition < safeMargin) {
                topPosition = safeMargin;
            }
            
            // If the popup would go off the bottom of the screen, position it from the bottom
            if (topPosition + popupHeight > viewportHeight - safeMargin) {
                topPosition = viewportHeight - popupHeight - safeMargin;
            }
            
            popup.style.top = topPosition + 'px';
            
            // Store reference to the active popup
            window.__activePopup = popup;
            
            // Make popup visible
            popup.style.opacity = '1';
        }, 10);
    };

    // Add mouse events to all elements involved
    pieChart.addEventListener('mouseenter', handleMouseEnter);
    popup.addEventListener('mouseenter', handleMouseEnter);
    pieChart.addEventListener('mouseleave', handleMouseLeave);
    popup.addEventListener('mouseleave', handleMouseLeave);
    
    // Create an invisible buffer area around the pie chart to make interaction smoother
    const bufferArea = document.createElement('div');
    bufferArea.style.position = 'absolute';
    bufferArea.style.top = '-15px';
    bufferArea.style.left = '-15px';
    bufferArea.style.right = '-15px';
    bufferArea.style.bottom = '-15px';
    bufferArea.style.zIndex = '-1';
    pieContainer.appendChild(bufferArea);
    
    bufferArea.addEventListener('mouseenter', handleMouseEnter);
    bufferArea.addEventListener('mouseleave', handleMouseLeave);

    pieContainer.appendChild(pieChart);
    pieContainer.appendChild(popup);

    return pieContainer;
}

// Global activePopup tracker
declare global {
    interface Window {
        __activePopup?: HTMLElement;
    }
}

// Helper to hide a specific popup with animation
function hidePopup(popup: HTMLElement) {
    popup.style.opacity = '0';
    
    // Only remove display: none if this popup is still the active one
    setTimeout(() => {
        if (popup.style.opacity === '0') {
            popup.style.display = 'none';
            
            // If this was the active popup, clear the reference
            if (window.__activePopup === popup) {
                window.__activePopup = undefined;
            }
        }
    }, 200); // Match the CSS transition time
}

// Helper to hide all other popups when a new one is shown
function hideAllPopups(exceptPopup: HTMLElement) {
    // Hide the previously active popup if there is one
    if (window.__activePopup && window.__activePopup !== exceptPopup) {
        hidePopup(window.__activePopup);
    }
}

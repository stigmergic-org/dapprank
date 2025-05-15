import './styles.css'
import { createRiskChart } from './pie-chart'
import { renderDappDetailsPage } from './report-renderer'
import { isContentHashOutdated } from './ens-resolver'
import { fetchCar, getJson } from './ipfs-utils'
import { getMimeTypeIcon } from './report-renderer'
import { calculateCensorshipResistanceScore, DappData } from './reports'

// @ts-ignore
import about from './pages/about.md'
// @ts-ignore
import dappspec from './pages/dappspec.md'
// @ts-ignore
import shameList from './pages/shame-list.md'
// @ts-ignore
import terms from './pages/terms.md'

import { CID } from 'multiformats/cid';

// Setup dark mode based on system preference
setupDarkMode();

// Initialize dapp list
loadCuratedNames().catch(err => {
    console.error('Failed to load curated names:', err)
    displayToast('Failed to load dapp list', 3000)
})

// Replace hash router with path-based router
window.addEventListener('popstate', handleRouteChange);
handleRouteChange(); // Call on initial load

// Variables to track sorting state
let currentSortColumn = 0; // Default sort by first column (name)
let currentSortDirection = 'asc'; // Default sort direction

// Replace the hasAddedCrownToFirstApp variable with a tracking of the highest score
let highestScore = 0;

// Cache object for seeders data
// const seedersCache = new Map<string, number>();

// Interface for IPFS provider information
interface IPFSProvider {
    ID: string;
    Addrs: string[];
    Schema: string;
}

// Interface for seeders response
interface SeedersResponse {
    Providers: IPFSProvider[];
}

// Function to fetch seeders data for a CID
async function fetchSeeders(cid: string): Promise<{count: number, providers: IPFSProvider[]}> {
    // Check cache first
    // if (seedersCache.has(cid)) {
    //     // For cached counts, we only return the count without provider details
    //     return { count: seedersCache.get(cid)!, providers: [] };
    // }
    
    try {
        const response = await fetch(`https://delegated-ipfs.dev/routing/v1/providers/${cid}`);
        if (!response.ok) {
            console.error(`Failed to fetch seeders for ${cid}: ${response.statusText}`);
            return { count: 0, providers: [] };
        }
        
        const data = await response.json() as SeedersResponse;
        const providers = data.Providers || [];
        const seedersCount = providers.length;
        
        // Cache the result
        // seedersCache.set(cid, seedersCount);
        
        return { count: seedersCount, providers };
    } catch (error) {
        console.error(`Error fetching seeders for ${cid}:`, error);
        return { count: -1, providers: [] };
    }
}

// Function to format provider IDs for the tooltip
function formatProvidersForTooltip(providers: IPFSProvider[]): string {
    if (providers.length === 0) {
        return 'No seeders found';
    }
    
    if (providers.length <= 3) {
        // Show full details for few providers
        return providers.map(p => `${p.ID.substring(0, 10)}... (${p.Addrs.length} addresses)`).join('\n');
    } else {
        // For many providers, just show the count and a few examples
        const examples = providers.slice(0, 3).map(p => `${p.ID.substring(0, 10)}...`).join('\n');
        return `${providers.length} seeders, including:\n${examples}\n...and ${providers.length - 3} more`;
    }
}

// Table sorting functionality
interface SortableColumn {
  index: number;
  selector: string;
  type: 'number' | 'text' | 'visual' | 'category' | 'domain';
  getValue: (row: HTMLTableRowElement, selector: string) => any;
}

// Define column configurations for sorting
const sortableColumns: SortableColumn[] = [
  {
    index: 0,
    selector: 'td:nth-child(1) .score-badge',
    type: 'number',
    getValue: (row, selector) => parseInt(row.querySelector(selector)?.textContent || '0', 10)
  },
  {
    index: 1,
    selector: 'td:nth-child(2) .table__item a',
    type: 'text',
    getValue: (row, selector) => {
      const element = row.querySelector(selector);
      if (!element) return '';
      
      // Get text content excluding crown emoji
      let text = '';
      element.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE && 
                  (node as Element).tagName.toLowerCase() === 'span' && 
                  !(node as Element).querySelector('.crown-emoji')) {
          text += (node as Element).textContent || '';
        }
      });
      return text.trim().toLowerCase();
    }
  },
  {
    index: 2,
    selector: '',
    type: 'visual',
    getValue: () => '' // Visual column (risk chart) - not sortable by content
  },
  {
    index: 3,
    selector: 'td:nth-child(4) .category-label',
    type: 'category',
    getValue: (row, selector) => row.querySelector(selector)?.textContent?.toLowerCase() || ''
  },
  {
    index: 4,
    selector: 'td:nth-child(5) a, td:nth-child(5) span',
    type: 'number',
    getValue: (row, selector) => parseInt(row.querySelector(selector)?.textContent || '0', 10)
  },
  {
    index: 5,
    selector: 'td:nth-child(6) a',
    type: 'domain',
    getValue: (row, selector) => {
      // Get the text content of the domain link
      const element = row.querySelector(selector);
      return element?.textContent?.toLowerCase() || '';
    }
  }
];

function handleRouteChange() {
    const path = window.location.pathname;
    const dappsTable = document.getElementById('dapps') as HTMLElement;
    const mainContent = document.getElementById('main-content') as HTMLElement;

    // Hide any active popups when changing routes
    if (window.__activePopup) {
        window.__activePopup.style.opacity = '0';
        window.__activePopup.style.display = 'none';
        window.__activePopup = undefined;
    }

    function displayContent(content: string) {
        dappsTable.style.display = 'none';
        mainContent.style.display = 'block';
        mainContent.innerHTML = content;
    }

    // Update active navigation tabs
    document.querySelectorAll('.navigation-tabs li').forEach(item => {
        item.classList.remove('active');
    });

    // Find and mark the current page as active
    const navLinks = document.querySelectorAll('.navigation-tabs li a');
    navLinks.forEach(link => {
        const href = (link as HTMLAnchorElement).getAttribute('href') || '';
        if (href === path) {
            (link as HTMLElement).parentElement?.classList.add('active');
        } else if (path === '/' && href === '/') {
            // Special case for home page
            (link as HTMLElement).parentElement?.classList.add('active');
        }
    });

    // Check if the path is for a dapp detail page
    if (path.includes('-eth')) {
        // We need a more sophisticated approach to convert URL path to ENS name
        // since some ENS names might already contain hyphens
        const ensName = convertPathToEnsName(path.substring(1));
        displayDappDetails(ensName);
        return;
    }

    if (path === '/' || path === '') {
        dappsTable.style.display = 'block';
        mainContent.style.display = 'none';
    } else if (path === '/about') {
        displayContent(about);
    } else if (path === '/dappspec') {
        displayContent(dappspec);
    } else if (path === '/shame-list') {
        displayContent(shameList);
    } else if (path === '/terms') {
        displayContent(terms);
    }
}

// Function to convert URL path to ENS name
function convertPathToEnsName(path: string): string {
    // If the path ends with -eth, we know it's an ENS name
    if (path.endsWith('-eth')) {
        // Replace the last occurrence of -eth with .eth
        const basePath = path.substring(0, path.length - 4);
        
        // For subdomains, we need to convert hyphens to dots
        // We'll use a pattern to identify subdomain separators
        // This assumes subdomains are separated by dots in the original ENS name
        
        // First, split by potential subdomain separators
        const parts = basePath.split('--');
        
        // Then join with dots
        return parts.join('.') + '.eth';
    }
    return path;
}

// Function to convert ENS name to URL path
function convertEnsNameToPath(ensName: string): string {
    // Replace dots that separate subdomains with double hyphens
    const parts = ensName.split('.');
    
    // The last part is 'eth', handle it separately
    const domain = parts.pop(); // Remove 'eth'
    
    // Join the remaining parts with double hyphens
    return parts.join('--') + '-' + domain;
}

// Function to display dapp details
async function displayDappDetails(ensName: string) {
    const dappsTable = document.getElementById('dapps') as HTMLElement;
    const mainContent = document.getElementById('main-content') as HTMLElement;
    
    dappsTable.style.display = 'none';
    mainContent.style.display = 'block';
    
    // Use the enhanced renderDappDetailsPage that handles all data fetching internally
    renderDappDetailsPage(
        ensName, 
        mainContent, 
        createRiskChart,
        getCategoryColor
    );
}

// Add a function to handle navigation links without page reload
function setupNavLinks() {
    // Select all navigation links in the header
    document.querySelectorAll('.navigation-tabs li a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const href = (e.currentTarget as HTMLAnchorElement).getAttribute('href');
            if (href) {
                history.pushState({}, '', href);
                handleRouteChange();
            }
        });
    });
}

// Call this after the DOM is loaded
document.addEventListener('DOMContentLoaded', setupNavLinks);

async function handleInput() {
    const userInputElement = document.getElementById('textInput') as HTMLInputElement;
    const ensName = userInputElement.value.trim();
    
    if (ensName.endsWith('.eth')) {
        const title = encodeURIComponent(`Add dapp: ${ensName}`);
        const encodedEnsName = encodeURIComponent(ensName);
        // Create the issue URL with prefilled title and ENS name field
        const issueUrl = `https://github.com/stigmergic-org/dapprank/issues/new?template=dapp-request.yml&title=${title}&ens_name=${encodedEnsName}`;
        
        // Open the GitHub issue in a new tab
        window.open(issueUrl, '_blank');
        
        // Show confirmation toast
        displayToast(`Opening GitHub issue to add ${ensName}`, 6000);
    } else {
        displayToast(`Invalid ENS name: ${ensName}`, 6000);
    }
}

// Function to set up table sorting
function setupTableSorting() {
  const dappsTable = document.getElementById('dapps');
  if (!dappsTable) return;
  
  const headers = dappsTable.querySelectorAll('th');
  
  // Remove any existing event listeners by cloning and replacing each header
  headers.forEach((header, headerIndex) => {
    const newHeader = header.cloneNode(true);
    header.parentNode?.replaceChild(newHeader, header);
  });
  
  // Get the fresh headers after replacement
  const freshHeaders = dappsTable.querySelectorAll('th');
  
  freshHeaders.forEach((header, headerIndex) => {
    // Create a wrapper for the header text and sort indicator
    const headerContent = document.createElement('span');
    headerContent.className = 'header-content';
    headerContent.style.display = 'inline-flex';
    headerContent.style.alignItems = 'center';
    
    // Move the header text into this wrapper
    headerContent.innerHTML = header.innerHTML;
    header.innerHTML = '';
    header.appendChild(headerContent);
    
    // Add sort indicator span if it doesn't exist
    let sortIndicator = headerContent.querySelector('.sort-indicator');
    if (!sortIndicator) {
      sortIndicator = document.createElement('span');
      sortIndicator.className = 'sort-indicator';
      sortIndicator.textContent = '';
      headerContent.appendChild(sortIndicator);
    }
    
    // Make header clickable
    header.style.cursor = 'pointer';
    
    // Add click event with a simple, direct approach
    header.onclick = function() {
      // Find the correct column index in sortableColumns
      let columnIndex = -1;
      const headerText = header.textContent?.replace(/[▲▼]/g, '').trim().toLowerCase();
      
      if (headerText === 'score') columnIndex = 0;
      else if (headerText === 'name') columnIndex = 1;
      else if (headerText === 'risks') {
        // When Risk column is clicked, sort by Score column instead
        columnIndex = 0; // Score column index
      }
      else if (headerText === 'category') columnIndex = 3;
      else if (headerText === 'seeders') columnIndex = 4;
      else if (headerText === 'domain' || headerText === 'link') columnIndex = 5;
      
      if (columnIndex === -1) {
        console.log(headerText, columnIndex)
        console.error(`Cannot sort by column: ${headerText}`);
        return;
      }
      
      // Determine sort direction
      let direction;
      
      // For Risk column, always sort by descending score (higher score = better)
      if (currentSortColumn === columnIndex) {
        // Toggle direction if same column
        direction = currentSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        // Default to descending for Seeders column on first click, ascending for others
        direction = columnIndex === 4 ? 'desc' : 'asc';
      }
      
      // Clear all sort indicators
      freshHeaders.forEach(h => {
        const ind = h.querySelector('.sort-indicator');
        if (ind) ind.textContent = '';
        h.classList.remove('sorted-asc', 'sorted-desc');
      });
      
      // Update this header's indicator
      if (sortIndicator) {
        sortIndicator.textContent = direction === 'asc' ? ' ▲' : ' ▼';
      }
      header.classList.add(direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
      
      // Update global state
      currentSortColumn = columnIndex;
      currentSortDirection = direction;
      
      // Perform the sort
      sortTable(columnIndex, direction);
    };
  });
}

// Function to sort the table
function sortTable(columnIndex: number, direction: string) {
  const table = document.querySelector('#dapps table');
  if (!table) return;
  
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  // Sort the rows
  rows.sort((a, b) => {
    let aValue, bValue;
    
    // Special handling for different column types
    if (columnIndex === 0) {
      // Score column - get the numeric value
      aValue = parseInt(a.querySelector('td:nth-child(1) .score-badge')?.textContent || '0', 10);
      bValue = parseInt(b.querySelector('td:nth-child(1) .score-badge')?.textContent || '0', 10);
    } else if (columnIndex === 1) {
      // Name column - get text content from the span inside the link
      const aSpan = a.querySelector('td:nth-child(2) .table__item a span:not(.crown-emoji)');
      const bSpan = b.querySelector('td:nth-child(2) .table__item a span:not(.crown-emoji)');
      aValue = aSpan?.textContent?.toLowerCase() || '';
      bValue = bSpan?.textContent?.toLowerCase() || '';
    } else if (columnIndex === 3) {
      // Category column
      aValue = a.querySelector('td:nth-child(4) .category-label')?.textContent?.toLowerCase() || '';
      bValue = b.querySelector('td:nth-child(4) .category-label')?.textContent?.toLowerCase() || '';
    } else if (columnIndex === 4) {
      // Seeders column - can be either an <a> link or a <span> for fallback
      aValue = parseInt(a.querySelector('td:nth-child(5) a, td:nth-child(5) span')?.textContent || '0', 10);
      bValue = parseInt(b.querySelector('td:nth-child(5) a, td:nth-child(5) span')?.textContent || '0', 10);

      aValue = Number.isNaN(aValue) ? -1 : aValue
      bValue = Number.isNaN(bValue) ? -1 : bValue
    } else if (columnIndex === 5) {
      // Domain column - direct selector for the link text
      aValue = a.querySelector('td:nth-child(6) a')?.textContent?.toLowerCase() || '';
      bValue = b.querySelector('td:nth-child(6) a')?.textContent?.toLowerCase() || '';
    } else {
      // Default case
      aValue = '';
      bValue = '';
    }
    
    // Compare the values
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      // For numeric values (like score)
      return direction === 'asc' ? aValue - bValue : bValue - aValue;
    } else {
      // For string values
      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    }
  });
  
  // Reorder the rows in the DOM
  rows.forEach(row => tbody.appendChild(row));
  
  // After reordering the rows, update the crowns
  updateCrownsForHighestScore();
}

// Call this function after the dapps table is populated
function initializeTableAfterPopulation() {
  setupTableSorting();
  
  // Reset the highest score when we repopulate the table
  highestScore = 0;
  
  // Sort by score (column 0) in descending order by default
  sortTable(0, 'desc');
  
  // Update the sort indicator on the score column
  const scoreHeader = document.querySelector('#dapps table thead tr th:first-child');
  if (scoreHeader) {
    const indicator = scoreHeader.querySelector('.sort-indicator');
    if (indicator) {
      indicator.textContent = ' ▼'; // Down arrow for descending
    }
    scoreHeader.classList.add('sorted-desc');
    
    // Update the current sort state
    currentSortColumn = 0;
    currentSortDirection = 'desc';
  }
  
  // After sorting, update crowns to ensure they're on the highest scoring apps
  updateCrownsForHighestScore();
}

// Add a function to update crowns after sorting
function updateCrownsForHighestScore() {
    // Find all icon containers
    const iconContainers = document.querySelectorAll('#dapps .table__item div[data-score]');
    
    // Find the highest score
    let maxScore = 0;
    iconContainers.forEach(container => {
        const score = parseInt(container.getAttribute('data-score') || '0', 10);
        maxScore = Math.max(maxScore, score);
    });
    
    // Update highestScore variable
    highestScore = maxScore;
    
    // Remove all crowns
    document.querySelectorAll('.crown-emoji').forEach(crown => crown.remove());
    
    // Add crowns to all apps with the highest score
    iconContainers.forEach(container => {
        const score = parseInt(container.getAttribute('data-score') || '0', 10);
        if (score === maxScore) {
            addCrownToElement(container as HTMLElement);
        }
    });
}

// Helper function to add crown to an element
function addCrownToElement(element: HTMLElement) {
    const crown = document.createElement('span');
    crown.textContent = '👑';
    crown.className = 'crown-emoji'; // Add a class for easier selection
    crown.style.position = 'absolute';
    crown.style.top = '-12px';
    crown.style.left = '-5px';
    crown.style.fontSize = '16px';
    crown.style.transform = 'rotate(-25deg)';
    element.appendChild(crown);
}

// Function to get score category (high, medium, low)
function getScoreCategory(score: number): string {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

// Modify the loadCuratedNames function to call updateTableHeader
async function loadCuratedNames() {
    try {
        // Use the new fetchCar function to get the unixfs instance and root CID
        const { fs, root } = await fetchCar('/dapps/index/')

        // Try to list the root directory
        try {
            for await (const entry of fs.ls(root)) {
                if (!entry.name) continue
                await processDappData(root, entry.name, fs)
            }
        } catch (error) {
            console.error('Error listing root directory:', error)
            return
        }

        // Update the table header to include the score column
        updateTableHeader();
        
        // After all dapps are loaded, initialize the table
        initializeTableAfterPopulation();
    } catch (error) {
        console.error('Error in loadCuratedNames:', error)
        throw error
    }
}

// Update processDappData to not require blockstore parameter
async function processDappData(root: CID, dappName: string, fs: any) {
    try {
        // Try different approaches to read metadata
        let metadata = await getJson(fs, root, `${dappName}/metadata.json`);
        // Try to read report.json
        let report = await getJson(fs, root, `${dappName}/report.json`);

        // Construct the favicon URL using archive directory with the block number
        let faviconUrl = '';
        if (report.favicon) {
            faviconUrl = `./dapps/archive/${dappName}/${report.blockNumber}/${report.favicon}`;
        } else {
            // Select icon based on rootMimeType
            faviconUrl = getMimeTypeIcon(report.rootMimeType);
        }

        // Create DappData object with all available information
        const dappData: DappData = {
            metadata,
            report,
            favicon: faviconUrl
        }
        // Process the dapp data
        await addDapp(dappName, dappData)

    } catch (error) {
        console.error(`Error processing dapp ${dappName}:`, error)
    }
}

// Update addDapp to accept the dapp data
async function addDapp(ensName: string, dappData?: DappData) {
    renderResultDiv(ensName, dappData)
}

function addDappRow(cells: HTMLElement[]): void {
    // Find the table inside the dapps div
    const dappsDiv = document.getElementById('dapps');
    if (!dappsDiv) {
        console.error('Could not find dapps div');
        return;
    }
    
    // Get the tbody element from the table
    const tbody = dappsDiv.querySelector('tbody');
    if (!tbody) {
        console.error('Could not find tbody in dapps table');
        return;
    }
    
    // Create a table row
    const row = document.createElement('tr');
    
    // Add each cell to the row
    cells.forEach(cell => {
        const td = document.createElement('td');
        td.appendChild(cell);
        row.appendChild(td);
    });
    
    // Add the row to the tbody
    tbody.appendChild(row);
}

// Map to store category colors
const categoryColorMap = new Map<string, string>();
const defaultCategories = ['defi', 'social', 'nft', 'wallet', 'personal', 'organization', 'knowledge base', 'filesharing', 'data', 'infofi', 'dev tool', 'other'];

// Function to get or generate a color for a category
function getCategoryColor(category: string): string {
    const lowerCategory = category.toLowerCase();
    
    // If we already have a color for this category, return it
    if (categoryColorMap.has(lowerCategory)) {
        return categoryColorMap.get(lowerCategory)!;
    }
    
    // If it's one of our predefined categories, use the CSS class
    if (defaultCategories.includes(lowerCategory)) {
        // For categories with spaces, we need to convert to CSS-friendly format
        const cssCategory = lowerCategory.replace(/\s+/g, '-');
        return `category-${cssCategory}`;
    }
    
    // Generate a color based on the category string
    const hue = Math.abs(lowerCategory.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 360;
    const color = `hsl(${hue}, 70%, 60%)`;
    
    // Store it for future use
    categoryColorMap.set(lowerCategory, color);
    
    // Add a dynamic style for this category
    const style = document.createElement('style');
    const cssCategory = lowerCategory.replace(/\s+/g, '-');
    style.textContent = `.category-${cssCategory} { background-color: ${color}; }`;
    document.head.appendChild(style);
    
    return `category-${cssCategory}`;
}

// Update renderResultDiv to add seeders column
async function renderResultDiv(
    ensName: string, 
    dappData: DappData
): Promise<void> {
    // Calculate censorship resistance score
    const score = calculateCensorshipResistanceScore(dappData);
    const scoreCategory = getScoreCategory(score);
    
    // Track the highest score we've seen
    highestScore = Math.max(highestScore, score);
    
    // Score cell
    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'table__item score-container';
    
    // Create a link wrapper for the score
    const scoreLink = document.createElement('a');
    scoreLink.href = `/${convertEnsNameToPath(ensName)}`;
    scoreLink.setAttribute('data-nav', 'true');
    
    // Create score badge
    const scoreBadge = document.createElement('div');
    scoreBadge.className = `score-badge score-${scoreCategory}`;
    scoreBadge.textContent = score.toString();
    
    scoreLink.appendChild(scoreBadge);
    scoreDiv.appendChild(scoreLink);

    // Dapp cell (icon + title)
    const dappDiv = document.createElement('div');
    dappDiv.className = 'table__item';
    const dappLink = document.createElement('a');
    
    // Use the new conversion function
    const urlPath = convertEnsNameToPath(ensName);
    dappLink.href = `/${urlPath}`;
    dappLink.setAttribute('data-nav', 'true');

    // Create a container for the icon and potential crown
    const iconContainer = document.createElement('div');
    iconContainer.style.position = 'relative';
    iconContainer.style.display = 'inline-block';
    
    // Add the dapp icon
    const dappIcon = document.createElement('img');
    dappIcon.src = dappData.favicon;
    dappIcon.alt = dappData.report.rootMimeType ? `${dappData.report.rootMimeType} icon` : 'dapp-logo';
    dappIcon.width = 24;
    dappIcon.height = 24;
    iconContainer.appendChild(dappIcon);
    
    // Add crown to this app if it has the highest score
    // We'll store the score as a data attribute to update crowns later if needed
    iconContainer.setAttribute('data-score', score.toString());
    
    if (score === highestScore) {
        addCrownToElement(iconContainer);
    }
    
    dappLink.appendChild(iconContainer);

    // Use the title from the report if available, otherwise use ENS name
    const titleText = document.createElement('span');
    titleText.textContent = dappData.report.title || ensName;
    titleText.style.marginLeft = '5px'; // Add some space between icon and text
    dappLink.appendChild(titleText);

    // Check if contentHash is outdated and add warning icon if needed
    if (dappData.report.contentHash) {
        // We'll check asynchronously to avoid blocking the UI
        isContentHashOutdated(ensName, dappData.report.contentHash).then((isOutdated: boolean) => {
            if (isOutdated) {
                const warningContainer = document.createElement('span');
                warningContainer.className = 'tooltip';
                
                const warningIcon = document.createElement('span');
                warningIcon.className = 'warning-icon';
                warningIcon.textContent = '⚠️';
                warningContainer.appendChild(warningIcon);
                
                const tooltip = document.createElement('span');
                tooltip.className = 'tooltip-text';
                tooltip.textContent = 'Content hash is outdated. The ENS record points to a newer version.';
                warningContainer.appendChild(tooltip);
                
                dappLink.appendChild(warningContainer);
            }
        }).catch((error: Error) => {
            console.error(`Error checking contentHash for ${ensName}:`, error);
        });
    }

    dappDiv.appendChild(dappLink);

    // Risks cell (pie chart)
    const risksDiv = document.createElement('div');
    risksDiv.className = 'table__item';
    
    // Create a link wrapper for the risk chart
    const riskLink = document.createElement('a');
    riskLink.href = `/${urlPath}`;
    riskLink.setAttribute('data-nav', 'true');
    
    // Add the risk chart to the link
    createRiskChart(dappData).then(chart => {
        riskLink.appendChild(chart);
    });
    
    // Add the link to the risks div
    risksDiv.appendChild(riskLink);

    // Category cell (label with color)
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'table__item';
    
    // Get category from metadata or default to "other"
    const category = dappData.metadata?.category || 'other';
    
    const categoryLabel = document.createElement('span');
    categoryLabel.className = `category-label ${getCategoryColor(category)}`;
    categoryLabel.textContent = category;
    categoryDiv.appendChild(categoryLabel);

    // Seeders cell
    const seedersDiv = document.createElement('div');
    seedersDiv.className = 'table__item';
    
    // Add a loading indicator initially
    const loadingText = document.createElement('span');
    loadingText.textContent = '...';
    loadingText.className = 'seeders-loading';
    seedersDiv.appendChild(loadingText);
    
    // Create seeders count element - now as a clickable link to data
    if (dappData.report.contentHash) {
        fetchSeeders(dappData.report.contentHash).then(result => {
            // Create a link for the seeders count with more explicit styling
            const seedersLink = document.createElement('a');
            seedersLink.textContent = result.count == -1 ? '?' : result.count.toString()
            seedersLink.href = `https://delegated-ipfs.dev/routing/v1/providers/${dappData.report.contentHash}`;
            seedersLink.target = '_blank';
            seedersLink.className = 'seeders-value';
            
            // Clear the loading placeholder and add the link
            seedersDiv.innerHTML = '';
            seedersDiv.appendChild(seedersLink);
        }).catch(error => {
            console.error(`Error fetching seeders for ${ensName}:`, error);
            
            // Replace loading indicator with error value with explicit styling
            seedersDiv.innerHTML = '';
            const seedersText = document.createElement('span');
            seedersText.textContent = '?';
            seedersDiv.appendChild(seedersText);
        });
    } else {
        // No content hash available, show 0 immediately with explicit styling
        seedersDiv.innerHTML = '';
        const seedersText = document.createElement('span');
        seedersText.textContent = '0';
        seedersDiv.appendChild(seedersText);
    }

    // Domain cell (ENS name)
    const domainDiv = document.createElement('div');
    domainDiv.className = 'table__item';
    const domainLink = document.createElement('a');
    domainLink.href = `https://${ensName}.link`;
    domainLink.textContent = ensName;
    domainLink.target = '_blank';
    domainLink.className = 'link-style'; // Add class for styling
    domainDiv.appendChild(domainLink);

    // Add the row with the cells in the new order: score, name, risk, category, seeders, domain
    addDappRow([scoreDiv, dappDiv, risksDiv, categoryDiv, seedersDiv, domainDiv]);
}

// Update the table header to include the score column
function updateTableHeader() {
    const tableHeader = document.querySelector('#dapps table thead tr');
    if (!tableHeader) return;
    
    // Check if we already have the Score header
    const existingScoreHeader = tableHeader.querySelector('th:first-child');
    if (existingScoreHeader && existingScoreHeader.textContent?.trim() === 'Score') {
        // We already have the Score header, nothing to do
        return;
    }
    
    // Create the score header cell
    const scoreHeader = document.createElement('th');
    scoreHeader.textContent = 'Score';
    
    // Insert it as the first column
    tableHeader.insertBefore(scoreHeader, tableHeader.firstChild);
    
    // Update the sort functionality to include the new column
    setupTableSorting();
}

async function displayToast(message: string, duration: number) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => document.body.removeChild(toast), duration);
}

const submitButton = document.getElementById('submitButton');
submitButton.addEventListener('click', handleInput);

// Add this function to handle dark mode with three states
function setupDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  
  // Theme can be 'light', 'dark', or 'system'
  const savedTheme = localStorage.getItem('theme') || 'system';
  const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Apply theme based on saved preference or device settings
  applyTheme(savedTheme, prefersDarkMode);
  
  // Setup listener for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('theme') === 'system') {
      setDarkModeClass(e.matches);
    }
  });
  
  // Setup theme toggle button - cycles through three states
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      // Cycle through themes: system -> light -> dark -> system
      const currentTheme = localStorage.getItem('theme') || 'system';
      let newTheme = 'system';
      
      switch (currentTheme) {
        case 'system':
          newTheme = 'light';
          break;
        case 'light':
          newTheme = 'dark';
          break;
        case 'dark':
          newTheme = 'system';
          break;
      }
      
      localStorage.setItem('theme', newTheme);
      applyTheme(newTheme, prefersDarkMode);
      
      // Update visual indicator (you might want to add some visual feedback)
      updateThemeIcon(newTheme, prefersDarkMode);
    });
    
    // Initialize the theme icon based on current theme
    updateThemeIcon(savedTheme, prefersDarkMode);
  }
}

// Helper function to apply theme state
function applyTheme(theme: string, systemPrefersDark: boolean) {
  if (theme === 'dark' || (theme === 'system' && systemPrefersDark)) {
    setDarkModeClass(true);
  } else {
    setDarkModeClass(false);
  }
}

// Helper function to update the theme icon
function updateThemeIcon(theme: string, systemPrefersDark: boolean) {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;
  
  // Clear existing text
  themeToggle.textContent = '';
  
  // Create the icon based on the current state
  let isDark = theme === 'dark' || (theme === 'system' && systemPrefersDark);
  
  // Create SVG icon - we'll use different icons for each state
  let svgIcon = '';
  
  if (theme === 'system') {
    // System theme - show computer icon
    svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="2" x2="9" y2="4"></line><line x1="15" y1="2" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="22"></line><line x1="15" y1="20" x2="15" y2="22"></line><line x1="20" y1="9" x2="22" y2="9"></line><line x1="20" y1="14" x2="22" y2="14"></line><line x1="2" y1="9" x2="4" y2="9"></line><line x1="2" y1="14" x2="4" y2="14"></line></svg>`;
  } else if (theme === 'light') {
    // Light theme - show sun icon
    svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  } else {
    // Dark theme - show moon icon
    svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  }
  
  themeToggle.innerHTML = svgIcon;
}

// Function to add or remove the dark-mode class
function setDarkModeClass(isDarkMode: boolean) {
  if (isDarkMode) {
    document.documentElement.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
  }
}

// After the document is fully loaded, initialize mobile enhancements
document.addEventListener('DOMContentLoaded', () => {
  setupDarkMode();
  setupNavLinks();
  setupMobileEnhancements();
  
  // ... rest of your existing initialization code ...
  
  // Add a global click handler to hide popups when clicking elsewhere
  document.addEventListener('click', (event) => {
    // Hide active popup when clicking elsewhere
    const activePopup = window.__activePopup;
    if (activePopup) {
      // Check if the click was outside the popup and not on a pie chart
      const target = event.target as HTMLElement;
      const isPieChart = target.closest('.pie-container') !== null;
      const isInPopup = activePopup.contains(target);
      
      if (!isInPopup && !isPieChart) {
        // Hide the popup with animation
        activePopup.style.opacity = '0';
        setTimeout(() => {
          if (activePopup.style.opacity === '0') {
            activePopup.style.display = 'none';
          }
          window.__activePopup = undefined;
        }, 200);
      }
    }
  });
});

// Function to set up mobile-specific enhancements
function setupMobileEnhancements() {
  // Set up table scrolling indicators
  const dappsContainer = document.getElementById('dapps');
  if (!dappsContainer) return;
  
  // Check if scrollable and add appropriate class
  const checkTableOverflow = () => {
    if (!dappsContainer) return;
    
    const table = dappsContainer.querySelector('table');
    if (!table) return;
    
    // Check if the table is wider than its container
    if (table.scrollWidth > dappsContainer.clientWidth) {
      dappsContainer.classList.add('has-overflow');
      
      // On mobile, slightly offset the scroll position to hint at horizontal scrollability
      if (window.innerWidth <= 768 && !dappsContainer.getAttribute('data-scroll-hint')) {
        // Only do this once per page load
        dappsContainer.setAttribute('data-scroll-hint', 'true');
        
        // Slight delay to ensure the table is fully rendered
        setTimeout(() => {
          // Scroll slightly right to indicate there's more content
          dappsContainer.scrollLeft = 10;
          
          // Then animate back to the start
          setTimeout(() => {
            dappsContainer.style.scrollBehavior = 'smooth';
            dappsContainer.scrollLeft = 0;
            
            // Reset scroll behavior after animation
            setTimeout(() => {
              dappsContainer.style.scrollBehavior = '';
            }, 500);
          }, 300);
        }, 500);
      }
    } else {
      dappsContainer.classList.remove('has-overflow');
    }
  };
  
  // Initial check
  checkTableOverflow();
  
  // Listen for window resize events
  window.addEventListener('resize', checkTableOverflow);
  
  // Update overflow indicators when table content changes
  const tableObserver = new MutationObserver(checkTableOverflow);
  tableObserver.observe(dappsContainer, { childList: true, subtree: true });
  
  // Fix iOS 100vh issue
  const setVhProperty = () => {
    // First we get the viewport height and we multiply it by 1% to get a value for a vh unit
    let vh = window.innerHeight * 0.01;
    // Then we set the value in the --vh custom property to the root of the document
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  
  // Initial calculation
  setVhProperty();
  
  // Recalculate on resize
  window.addEventListener('resize', setVhProperty);
  
  // Add "pull to scroll" indicator for mobile
  if (window.innerWidth <= 768) {
    const pullIndicator = document.createElement('div');
    pullIndicator.className = 'pull-to-scroll-indicator';
    pullIndicator.innerHTML = '<span>← swipe →</span>';
    dappsContainer.appendChild(pullIndicator);
    
    // Fade out the indicator after a few seconds
    setTimeout(() => {
      pullIndicator.style.opacity = '0';
      setTimeout(() => {
        pullIndicator.remove();
      }, 500);
    }, 3000);
  }
}

// Add type definition for the __activePopup global
declare global {
    interface Window {
        __activePopup?: HTMLElement;
    }
}

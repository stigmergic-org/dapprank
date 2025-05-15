// Interface for dapp metadata
export interface DappMetadata {
    description?: string;
    category?: string;
    [key: string]: any; // Allow other properties
}

// Interface for dapp data structure needed for scoring
export interface DappData {
    metadata: DappMetadata;
    report: {
        title?: string;
        contentHash?: string;
        timestamp?: number;
        blockNumber?: number;
        totalSize?: number;
        hasFavicon?: boolean;
        rootMimeType?: string;
        distributionPurity?: {
            externalScripts?: {
                file: string;
                offenders: {
                    type: string;
                    url: string;
                }[];
            }[];
            externalMedia?: {
                file: string;
                offenders: {
                    type: string;
                    url: string;
                }[];
            }[];
        };
        networkingPurity?: {
            http?: {
                file: string;
                offenders: string[];
            }[];
            websocket?: {
                file: string;
                offenders: string[];
            }[];
            webrtc?: any[];
        };
        web3?: {
            file: string;
            offenders: {
                service: string;
                url: string;
                risk: string;
            }[];
        }[];
    };
    favicon?: string;
}

// We only need to keep the SummarizedReport interface since that's what we're generating
export interface SummarizedReport {
    distributionPurity: {
        externalScripts: number;
        externalMedia: number;
    };
    networkingPurity: {
        http: number;
        websocket: number;
        webrtc: number;
    };
    web3: {
        none: number;
        fair: number;
        high: number;
    };
}

/**
 * Get the category (high, medium, low) for a given score
 * @param score The numerical score to categorize
 * @returns The score category as a string
 */
export function getScoreCategory(score: number): string {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

/**
 * Calculates a censorship resistance score for a dapp based on its characteristics
 * @param dappData The dapp data containing distribution, networking, and web3 information
 * @returns A score between 0 and 100
 */
export function calculateCensorshipResistanceScore(dappData: DappData): number {
    let score = 70; // Start with a baseline score of 70
    
    // Check for distribution purity issues
    const hasDistributionIssues = dappData.report.distributionPurity && 
        ((dappData.report.distributionPurity.externalScripts?.length || 0) > 0 || 
         (dappData.report.distributionPurity.externalMedia?.length || 0) > 0);
    
    // Check for networking purity issues
    const hasNetworkingIssues = dappData.report.networkingPurity && 
        ((dappData.report.networkingPurity.http?.length || 0) > 0 || 
         (dappData.report.networkingPurity.websocket?.length || 0) > 0 || 
         (dappData.report.networkingPurity.webrtc?.length || 0) > 0);
    
    // Add points for web3 interactions (positive factor) ONLY if there are no distribution or networking issues
    if (!hasDistributionIssues && !hasNetworkingIssues && dappData.report.web3 && dappData.report.web3.length > 0) {
        // Count the total number of web3 interactions
        const web3Count = dappData.report.web3.reduce((total, item) => {
            return total + (item.offenders ? item.offenders.length : 0);
        }, 0);
        console.log(`Web3 count: ${web3Count}`);
        // Add points based on the number of web3 interactions
        score += Math.min(web3Count * 5, 30); // Cap at 30 points
    }
    
    // Subtract points for distribution purity issues (negative factor)
    if (hasDistributionIssues) {
        // Count external scripts
        const externalScriptsCount = dappData.report.distributionPurity.externalScripts?.length || 0;
        
        // Count external media
        const externalMediaCount = dappData.report.distributionPurity.externalMedia?.length || 0;
        
        // Calculate penalties with caps per category
        const scriptsPenalty = Math.min(externalScriptsCount * 5, 25);
        const mediaPenalty = Math.min(externalMediaCount * 1, 5);
        
        // Apply total distribution penalty with overall cap
        score -= Math.min(scriptsPenalty + mediaPenalty, 30);
    }
    
    // Subtract points for networking purity issues (negative factor)
    if (hasNetworkingIssues) {
        // Count HTTP requests
        const httpCount = dappData.report.networkingPurity.http?.length || 0;
        
        // Count WebSocket connections
        const websocketCount = dappData.report.networkingPurity.websocket?.length || 0;
        
        // Count WebRTC connections
        const webrtcCount = dappData.report.networkingPurity.webrtc?.length || 0;
        
        // Calculate penalties with caps per category
        const httpPenalty = Math.min(httpCount * 3, 20);
        const websocketPenalty = Math.min(websocketCount * 2, 15);
        const webrtcPenalty = Math.min(webrtcCount * 1, 5);
        
        // Apply total networking penalty with overall cap
        score -= Math.min(httpPenalty + websocketPenalty + webrtcPenalty, 40);
    }
    
    // Ensure score stays within 0-100 range
    return Math.max(0, Math.min(100, score));
}

// This function takes any report object and generates a summarized version
export function generateSummarizedReport(report: any): SummarizedReport {
    if (!report) {
        return null;
    }
    
    return {
        distributionPurity: {
            externalScripts: report.distributionPurity?.externalScripts?.length || 0,
            externalMedia: report.distributionPurity?.externalMedia?.length || 0
        },
        networkingPurity: {
            http: report.networkingPurity?.http?.length || 0,
            websocket: report.networkingPurity?.websocket?.length || 0,
            webrtc: report.networkingPurity?.webrtc?.length || 0
        },
        web3: {
            none: report.web3?.map((web3: any) => 
                web3.offenders.filter((offender: any) => offender.risk === 'none').length
            ).reduce((a: number, b: number) => a + b, 0) || 0,
            fair: report.web3?.map((web3: any) => 
                web3.offenders.filter((offender: any) => offender.risk === 'fair').length
            ).reduce((a: number, b: number) => a + b, 0) || 0,
            high: report.web3?.map((web3: any) => 
                web3.offenders.filter((offender: any) => offender.risk === 'high').length
            ).reduce((a: number, b: number) => a + b, 0) || 0
        }
    };
}


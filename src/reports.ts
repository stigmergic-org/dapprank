// Interface for dapp metadata
export interface DappMetadata {
    description?: string;
    category?: string;
    [key: string]: any; // Allow other properties
}

// Interface for report structure
export interface Report {
    version: 2;
    contentHash: string;
    timestamp: number;
    blockNumber: number | null;
    rootMimeType: string;
    totalSize: number;
    favicon: string;
    title: string;
    distributionPurity: {
        externalScripts: {
            file: string;
            occurences: {
                type: string;
                url: string;
            }[];
        }[];
        externalMedia: {
            file: string;
            occurences: {
                type: string;
                url: string;
            }[];
        }[];
    };
    networkingPurity: {
        file: string;
        occurences: {
            method: string;
            urls: string[];
            library?: string;
            type: 'rpc' | 'bundler' | 'auxiliary' | 'self';
            motivation: string;
        }[];
    }[];
    libraryUsage: {
        file: string;
        occurences: {
            name: string;
            motivation: string;
        }[];
    }[];
    urls: any[]; // Not used in scoring currently
    ethereum: {
        file: string;
        occurences: {
            count: number;
        }[];
    }[];
    fallbacks: any[]; // Not used in scoring currently
    dappspec?: {
        dappspec: string;
        repository?: string;
        preserveHistory?: number;
        chains?: Record<string, {
            rpcs?: string[];
            bundlers?: string[];
            contracts?: string[];
        }>;
        fallbacks?: {
            url: string;
            motivation: string;
        }[];
        auxiliary?: {
            url: string;
            motivation: string;
        }[];
    };
}

// Interface for dapp data structure needed for scoring
export interface DappspecManifest {
  dappspec: string;
  repository: string;
  preserveHistory: number;
  dservices: {
    self: string[];
    serviceWorker: boolean;
    external: string[];
  };
  chains: {
    [chainId: string]: {
      rpcs: string[];
      bundlers: string[];
      contracts: string[];
    }
  }
  fallbacks: {
    window: boolean;
    rpcs: boolean;
    bundlers: boolean; 
    dservice: boolean;
  };
  auxiliary: {
    url: string;
    motivation: string;
  }[];
}
export interface DappData {
    metadata: DappMetadata;
    report: Report;
    dappspec?: DappspecManifest;
    favicon: string;
}

// Interface for summarized report
export interface SummarizedReport {
    distribution: {
        externalScripts: number;
        externalMedia: number;
    };
    networking: {
        rpc: number;
        bundler: number;
        self: number;
        auxiliary: number;
    };
    dappspec: {
        hasDappspec: boolean;
        fallbacks: number;
        blockchains: number;
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
 * @param dappData The dapp data containing distribution, networking, and ethereum information
 * @returns A score between 0 and 100
 */
export function calculateCensorshipResistanceScore(dappData: DappData): number {
    let score = 70; // Start with a baseline score of 70
    const report = dappData.report;
    
    // Check for distribution purity issues
    const hasDistributionIssues = report.distributionPurity && 
        ((report.distributionPurity.externalScripts?.length || 0) > 0 || 
         (report.distributionPurity.externalMedia?.length || 0) > 0);
    
    // Distribution penalty (keeping as is)
    if (hasDistributionIssues) {
        const externalScriptsCount = report.distributionPurity.externalScripts?.length || 0;
        const externalMediaCount = report.distributionPurity.externalMedia?.length || 0;
        
        const scriptsPenalty = Math.min(externalScriptsCount * 5, 25);
        const mediaPenalty = Math.min(externalMediaCount * 1, 5);
        
        score -= Math.min(scriptsPenalty + mediaPenalty, 30);
    }

    // Networking scoring
    if (report.networkingPurity) {
        // Count occurrences by type
        const networkingTypes = report.networkingPurity.reduce((acc, item) => {
            item.occurences.forEach(occ => {
                acc[occ.type] = (acc[occ.type] || 0) + 1;
            });
            return acc;
        }, { rpc: 0, bundler: 0, auxiliary: 0, self: 0 } as Record<string, number>);

        // Auxiliary penalty (-5 per aux, max -25)
        const auxPenalty = Math.min(networkingTypes.auxiliary * 5, 25);
        score -= auxPenalty;

        // RPC and bundler bonuses (+3 each if present)
        if (networkingTypes.rpc > 0) score += 3;
        if (networkingTypes.bundler > 0) score += 3;
    }

    // Ethereum presence bonus (+5 if any ethereum interactions)
    if (report.ethereum && report.ethereum.length > 1) {
        score += 5;
    }

    // Dappspec bonuses
    if (dappData.dappspec) {
        const dappspec = dappData.dappspec;
        
        // Count unique RPCs and bundlers from chains
        const uniqueUrls = new Set<string>();
        if (dappspec.chains) {
            Object.values(dappspec.chains).forEach(chain => {
                chain.rpcs?.forEach(rpc => uniqueUrls.add(rpc));
                chain.bundlers?.forEach(bundler => uniqueUrls.add(bundler));
            });
        }
        score += uniqueUrls.size * 3;

        // Auxiliary matches
        const networkingAuxUrls = new Set(
            report.networkingPurity
                ?.flatMap(item => item.occurences)
                .filter(occ => occ.type === 'auxiliary')
                .flatMap(occ => occ.urls) || []
        );

        const matchingAux = (dappspec.auxiliary || []).filter(aux => 
            Array.from(networkingAuxUrls).some(url => url.includes(aux.url))
        ).length;
        score += matchingAux * 4;

        // Fallbacks bonus - count number of enabled fallbacks
        const fallbackCount = dappspec.fallbacks ? 
            Object.values(dappspec.fallbacks).filter(Boolean).length : 0;
        score += fallbackCount * 7;
    }
    
    // Ensure score stays within 0-100 range
    return Math.max(0, Math.min(100, score));
}

/**
 * Generates a summarized version of a report
 * @param dappData The full dapp data including report and dappspec
 * @returns A summarized report with counts of various metrics
 */
export function generateSummarizedReport(dappData: DappData): SummarizedReport {
    if (!dappData || !dappData.report) {
        return null;
    }

    const report = dappData.report;

    // Count total occurrences for distribution
    const externalScriptsCount = report.distributionPurity?.externalScripts?.reduce(
        (total, script) => total + (script.occurences?.length || 0), 0
    ) || 0;
    
    const externalMediaCount = report.distributionPurity?.externalMedia?.reduce(
        (total, media) => total + (media.occurences?.length || 0), 0
    ) || 0;

    // Count networking occurrences by type
    const networkingCounts = report.networkingPurity?.reduce((counts, item) => {
        item.occurences.forEach(occ => {
            counts[occ.type] = (counts[occ.type] || 0) + 1;
        });
        return counts;
    }, { rpc: 0, bundler: 0, self: 0, auxiliary: 0 }) || { rpc: 0, bundler: 0, self: 0, auxiliary: 0 };

    // Get dappspec information
    const hasDappspec = !!dappData.dappspec;
    const dappspecFallbacks = dappData.dappspec?.fallbacks ? 
        Object.values(dappData.dappspec.fallbacks).filter(Boolean).length : 0;
    
    // Add ethereum interactions to fallbacks count if present
    const hasEthereumInteractions = report.ethereum && report.ethereum.length > 0;
    const fallbacks = dappspecFallbacks + (hasEthereumInteractions ? 1 : 0);
    
    const blockchains = dappData.dappspec?.chains ? Object.keys(dappData.dappspec.chains).length : 0;

    return {
        distribution: {
            externalScripts: externalScriptsCount,
            externalMedia: externalMediaCount
        },
        networking: networkingCounts,
        dappspec: {
            hasDappspec,
            fallbacks,
            blockchains
        }
    };
}



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


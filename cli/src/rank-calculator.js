import { promises as fs } from 'fs'
import { join } from 'path'
import { ANALYSIS_VERSION } from './constants.js'
import { logger } from './logger.js'

// Current version of the ranking algorithm
export const RANK_VERSION = 1

// Category weights (out of 100 total)
export const CATEGORY_WEIGHTS = {
  distribution: 35,
  networking: 30,
  governance: 20,
  manifest: 15
}

// Governance scoring by owner type
const GOVERNANCE_SCORES = {
  'EOA': 10,                           // Baseline - single owner
  'Safe': 16,                          // Multisig
  'DAO_Governor': 20,                  // Full DAO governance
  'DAO_MolochBaal': 20,                // Full DAO governance
  'ContractWallet_SingleOwner': 10,    // Same as EOA - single owner control
  'Contract_Unknown': 5,               // Unknown governance
  'EIP7702': 10,                       // Delegated EOA
  'No_Owner_Found': 0,                 // No owner
  'Error': 0                           // Error in analysis
}

/**
 * Score the distribution purity (35 points max)
 * Lower scores for external dependencies
 * @param {Object} report - The dapp report
 * @returns {number} Score out of 35
 */
export function scoreDistribution(report) {
  let score = CATEGORY_WEIGHTS.distribution
  
  // Count all external dependencies across all files
  const files = report.files || []
  
  let externalScriptsCount = 0
  let externalMediaCount = 0
  
  for (const file of files) {
    if (file.distributionPurity) {
      externalScriptsCount += (file.distributionPurity.externalScripts || []).length
      externalMediaCount += (file.distributionPurity.externalMedia || []).length
    }
  }
  
  // Penalties
  const scriptsPenalty = Math.min(externalScriptsCount * 5, 30)
  const mediaPenalty = Math.min(externalMediaCount * 1, 5)
  
  score -= scriptsPenalty
  score -= mediaPenalty
  
  logger.debug(`Distribution: ${externalScriptsCount} external scripts (-${scriptsPenalty}), ${externalMediaCount} external media (-${mediaPenalty})`)
  
  return Math.max(0, score)
}

/**
 * Score the networking implementation (30 points max)
 * Penalize poor networking, neutral for self-hosted/proper fallbacks
 * @param {Object} report - The dapp report
 * @returns {number} Score out of 30
 */
export function scoreNetworking(report) {
  let score = CATEGORY_WEIGHTS.networking
  const files = report.files || []
  
  // Check if there's any networking at all
  const hasAnyNetworking = files.some(f => f.networking && f.networking.length > 0)
  
  if (!hasAnyNetworking) {
    // Truly static site with no networking - perfect score
    logger.debug('Networking: Static app (no networking at all) - full score')
    return score
  }
  
  // Count networking occurrences and track presence by type
  const networkingCounts = { rpc: 0, bundler: 0, auxiliary: 0, self: 0, 'ccip-read': 0 }
  const hasNetworkingType = { rpc: false, bundler: false, auxiliary: false, self: false, 'ccip-read': false }
  
  for (const file of files) {
    if (file.networking && Array.isArray(file.networking)) {
      for (const net of file.networking) {
        if (net.type && networkingCounts.hasOwnProperty(net.type)) {
          networkingCounts[net.type]++
          hasNetworkingType[net.type] = true
        }
      }
    }
  }
  
  // Check for fallback support in the code
  const hasFallbacks = files.some(f => f.fallbacks && f.fallbacks.length > 0)
  
  // Check if app uses window.ethereum
  const hasWindowEthereum = files.some(f => f.usesWindowEthereum === true)
  
  logger.debug(`Networking types: rpc=${networkingCounts.rpc}, bundler=${networkingCounts.bundler}, auxiliary=${networkingCounts.auxiliary}, self=${networkingCounts.self}, ccip-read=${networkingCounts['ccip-read']}`)
  logger.debug(`Has fallbacks in code: ${hasFallbacks}, Has window.ethereum: ${hasWindowEthereum}`)
  
  // Penalties for poor networking
  
  // Auxiliary services: -5 per occurrence (max -20)
  const auxPenalty = Math.min(networkingCounts.auxiliary * 5, 20)
  score -= auxPenalty
  
  if (auxPenalty > 0) {
    logger.debug(`Networking: -${auxPenalty} for ${networkingCounts.auxiliary} auxiliary service occurrence(s)`)
  }
  
  // RPC: Penalize if type is present AND no fallback support
  // window.ethereum provides partial fallback value
  if (hasNetworkingType.rpc && !hasFallbacks) {
    if (hasWindowEthereum) {
      score -= 2
      logger.debug('Networking: -2 for RPC without explicit fallback (has window.ethereum)')
    } else {
      score -= 5
      logger.debug('Networking: -5 for RPC without any fallback')
    }
  }
  
  // Bundler: Penalize if type is present AND no fallback support
  // window.ethereum does NOT help bundler
  if (hasNetworkingType.bundler && !hasFallbacks) {
    score -= 5
    logger.debug('Networking: -5 for bundler without fallbacks')
  }
  
  // Self-hosted URLs and ccip-read are neutral (no penalty, no bonus)
  // They're expected behavior and don't affect the score
  
  return Math.max(0, Math.min(CATEGORY_WEIGHTS.networking, score))
}

/**
 * Score the governance transparency (20 points max)
 * Higher scores for decentralized governance
 * @param {Object} report - The dapp report
 * @returns {number} Score out of 20
 */
export function scoreGovernance(report) {
  const ownerAnalysis = report.ownerAnalysis
  
  if (!ownerAnalysis || !ownerAnalysis.type) {
    logger.debug('Governance: No owner analysis found')
    return 0
  }
  
  const ownerType = ownerAnalysis.type
  const score = GOVERNANCE_SCORES[ownerType] || 0
  
  logger.debug(`Governance: Owner type '${ownerType}' = ${score} points`)
  
  return score
}

/**
 * Score the manifest completeness (15 points max)
 * Higher scores for complete PWA manifest
 * @param {Object} report - The dapp report
 * @param {string} reportDir - Directory where the report is located
 * @returns {Promise<number>} Score out of 15
 */
export async function scoreManifest(report, reportDir) {
  // Check if manifest file reference exists in report
  if (!report.webmanifest || report.webmanifest === '') {
    logger.debug('Manifest: No manifest file referenced in report')
    return 0
  }
  
  // Try to load the manifest.json from assets directory
  const manifestPath = join(reportDir, 'assets', report.webmanifest)
  
  let manifest
  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf8')
    manifest = JSON.parse(manifestContent)
  } catch (error) {
    throw new Error(`Manifest file referenced but not found in assets: ${manifestPath}\nThis may indicate a corrupted report. Please re-analyze.`)
  }
  
  // Score based on completeness
  let score = 0
  
  if (manifest.name && manifest.name.trim() !== '') {
    score += 6
    logger.debug('Manifest: +6 for name field')
  }
  
  if (manifest.description && manifest.description.trim() !== '') {
    score += 4
    logger.debug('Manifest: +4 for description field')
  }
  
  if (manifest.icons && Array.isArray(manifest.icons) && manifest.icons.length > 0) {
    score += 3
    logger.debug(`Manifest: +3 for ${manifest.icons.length} icon(s)`)
  }
  
  if (manifest.screenshots && Array.isArray(manifest.screenshots) && manifest.screenshots.length > 0) {
    score += 2
    logger.debug(`Manifest: +2 for ${manifest.screenshots.length} screenshot(s)`)
  }
  
  return score
}

/**
 * Validate report version matches current analysis version
 * @param {Object} report - The dapp report
 * @throws {Error} If version mismatch
 */
export function validateReportVersion(report) {
  if (!report.version) {
    throw new Error('Report missing version field')
  }
  
  if (report.version !== ANALYSIS_VERSION) {
    throw new Error(
      `Report version mismatch\n` +
      `Found version: ${report.version}, expected: ${ANALYSIS_VERSION}\n` +
      `Please re-analyze with: dapprank analyze <ens-name> --force`
    )
  }
}

/**
 * Calculate the overall rank score for a dapp
 * @param {Object} report - The dapp report
 * @param {string} reportDir - Directory where the report is located
 * @returns {Promise<Object>} Rank score with breakdown
 */
export async function calculateRankScore(report, reportDir) {
  // Validate report version first
  validateReportVersion(report)
  
  // Calculate individual category scores
  const distribution = scoreDistribution(report)
  const networking = scoreNetworking(report)
  const governance = scoreGovernance(report)
  const manifest = await scoreManifest(report, reportDir)
  
  // Calculate overall score
  const overallScore = distribution + networking + governance + manifest
  
  return {
    rankVersion: RANK_VERSION,
    overallScore,
    maxScore: 100,
    categories: {
      distribution: {
        score: distribution,
        maxScore: CATEGORY_WEIGHTS.distribution
      },
      networking: {
        score: networking,
        maxScore: CATEGORY_WEIGHTS.networking
      },
      governance: {
        score: governance,
        maxScore: CATEGORY_WEIGHTS.governance
      },
      manifest: {
        score: manifest,
        maxScore: CATEGORY_WEIGHTS.manifest
      }
    }
  }
}

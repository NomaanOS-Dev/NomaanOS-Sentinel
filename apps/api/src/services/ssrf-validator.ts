// apps/api/src/services/ssrf-validator.ts
// Comprehensive SSRF (Server-Side Request Forgery) protection validator

import dns from 'dns';
import net from 'net';
import { config } from '../config/env.js';

export interface SsrfValidationResult {
  valid: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Checks if an IPv4 address string falls within prohibited private, loopback, or metadata CIDR ranges.
 */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // invalid format treated as prohibited
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private RFC 1918)
  if (b0 === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 100.64.0.0/10 (Shared Address Space / Carrier-Grade NAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 169.254.0.0/16 (Link-Local & Cloud Metadata e.g. 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private RFC 1918)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16 (Private RFC 1918)
  if (b0 === 192 && b1 === 168) return true;

  // 198.18.0.0/15 (Network Interconnect Device Benchmark Testing)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reserved) & 255.255.255.255 (Broadcast)
  if (b0 >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address string falls within prohibited private, loopback, or metadata ranges.
 */
function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // ::1 (Loopback) or :: (Unspecified)
  if (normalized === '::1' || normalized === '::') return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:a00:1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.replace('::ffff:', '');
    if (net.isIPv4(v4Part)) {
      return isPrivateOrReservedIPv4(v4Part);
    }
    return true;
  }

  // fe80::/10 (Link-Local Unicast)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // fc00::/7 & fd00::/8 (Unique Local Address - RFC 4193, includes cloud metadata fd00:ec2::254)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  // ff00::/8 (Multicast)
  if (normalized.startsWith('ff')) {
    return true;
  }

  // 2001:db8::/32 (Documentation)
  if (normalized.startsWith('2001:db8:')) {
    return true;
  }

  return false;
}

export class SsrfValidator {
  /**
   * Validates whether an IP address is private, loopback, link-local, or cloud metadata.
   */
  public isBlockedIp(ip: string): boolean {
    const isV4 = net.isIPv4(ip);
    const isV6 = net.isIPv6(ip);

    if (!isV4 && !isV6) {
      return true; // Not a valid IP
    }

    if (isV4) {
      return isPrivateOrReservedIPv4(ip);
    }

    return isPrivateOrReservedIPv6(ip);
  }

  /**
   * Validates destination URL for schema, host, and resolved IP addresses.
   * Resolves all DNS records (A and AAAA) to prevent DNS rebinding and internal network penetration.
   */
  public async validateWebhookDestination(
    urlString: string,
    allowInsecureHttpOverride?: boolean
  ): Promise<SsrfValidationResult> {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      return { valid: false, reason: 'Invalid destination URL format.' };
    }

    // 1. Protocol Scheme Enforcement
    const allowInsecure =
      allowInsecureHttpOverride !== undefined
        ? allowInsecureHttpOverride
        : config.outboundWebhooks.allowInsecureHttp;

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, reason: `Unsupported protocol scheme '${parsed.protocol}'. Only https:// (or http:// in dev) is permitted.` };
    }

    if (parsed.protocol === 'http:' && !allowInsecure) {
      return {
        valid: false,
        reason: 'Insecure http:// destination blocked. HTTPS is required for outbound webhook deliveries in production.',
      };
    }

    // 2. Hostname Validation
    const hostname = parsed.hostname.toLowerCase().trim();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return { valid: false, reason: `Blocked local or internal hostname '${hostname}'.` };
    }

    // 3. Direct IP Address Check (if hostname is an IP)
    if (net.isIP(hostname)) {
      if (this.isBlockedIp(hostname)) {
        return { valid: false, reason: `Destination IP '${hostname}' belongs to a private, loopback, or cloud metadata address range.` };
      }
      return { valid: true, resolvedIp: hostname };
    }

    // 4. DNS Resolution & Re-validation
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return { valid: false, reason: `Unable to resolve destination hostname '${hostname}'.` };
      }

      for (const rec of records) {
        if (this.isBlockedIp(rec.address)) {
          return {
            valid: false,
            reason: `Destination hostname '${hostname}' resolves to restricted internal address '${rec.address}'.`,
            resolvedIp: rec.address,
          };
        }
      }

      return { valid: true, resolvedIp: records[0].address };
    } catch (dnsErr) {
      return {
        valid: false,
        reason: `DNS lookup failed for destination hostname '${hostname}': ${dnsErr instanceof Error ? dnsErr.message : String(dnsErr)}`,
      };
    }
  }
}

export const ssrfValidator = new SsrfValidator();


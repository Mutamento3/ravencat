/** 统一 MCP Server 端点校验：返回规范化 URL 与端点分类；UI/Repository/MCP Client 不各自实现。 */

import type { ValidatedMcpEndpoint } from '@platform/mcp';
import { McpConfigError } from './McpConfigError';

/**
 * 产品只允许精确的本机回环主机：
 * - localhost
 * - 127.0.0.1
 * - [::1]
 * 不允许整个 127.0.0.0/8、IPv6 展开形式或带 zone identifier 的形式。
 */
const EXACT_LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 校验是否精确本机回环主机。 */
function isExactLoopbackHostname(hostname: string): boolean {
  return EXACT_LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * 统一端点校验入口：
 * - remote_https：仅 https；
 * - loopback_http：仅 http://localhost、http://127.0.0.1、http://[::1]；
 * - private_http：http:// + RFC 1918 私网 IPv4（10/8、172.16/12、192.168/16）、
 *   CGNAT 100.64.0.0/10（Tailscale 地址段）、IPv6 ULA（fc00::/7）
 *   或 Tailscale MagicDNS 域名（*.ts.net）。手机连电脑局域网/tailnet MCP Server 的标准形态。
 * 拒绝 userinfo、fragment、非 HTTP(S)、公网/0.0.0.0 的 http。
 * 重定向边界由客户端 transport 在同一允许范围内约束。
 */
export function validateMcpServerEndpoint(url: string): ValidatedMcpEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new McpConfigError('URL_INVALID', 'Server URL 不是合法地址');
  }

  if (parsed.username || parsed.password) {
    throw new McpConfigError('URL_USERINFO', 'URL 中禁止包含用户名或密码');
  }
  if (parsed.hash) {
    throw new McpConfigError('URL_FRAGMENT', 'URL 中禁止包含 fragment');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'https:') {
    parsed.hash = '';
    return { normalizedUrl: parsed.toString(), endpointClass: 'remote_https' };
  }
  if (protocol !== 'http:') {
    throw new McpConfigError('URL_PROTOCOL', '只允许 https:// 或本机回环/私网 http:// 地址');
  }

  // 规范化后精确校验 hostname：IPv6 字面量保留方括号，非括号形式必须是 localhost/127.0.0.1。
  const hostname = parsed.hostname.toLowerCase();
  if (!isExactLoopbackHostname(hostname)) {
    // 非回环的 http 仅放行 RFC 1918 私网 IPv4 与 IPv6 ULA（局域网设备场景）。
    if (!isPrivateNetworkHostname(hostname)) {
      throw new McpConfigError(
        'URL_PROTOCOL',
        'http:// 仅允许本机回环或私网地址（如 192.168.x.x / 10.x.x.x / 172.16-31.x.x）；公网地址必须使用 https://'
      );
    }
    parsed.hash = '';
    return { normalizedUrl: parsed.toString(), endpointClass: 'private_http' };
  }

  parsed.hash = '';
  return { normalizedUrl: parsed.toString(), endpointClass: 'loopback_http' };
}

/**
 * 校验是否"可明文 http"的私有地址：
 * - Tailscale MagicDNS：*.ts.net 由 Tailscale 托管，仅解析到 tailnet 内设备；
 * - IPv6 字面量：ULA fc00::/7（含 Tailscale 分配的 fd7a:115c:a1e0::/48）；
 * - IPv4 字面量：RFC 1918（10/8、172.16/12、192.168/16）与 CGNAT 100.64.0.0/10。
 * 上述范围的传输层在局域网/尾网内，Tailscale 场景更有 WireGuard 端到端加密；
 * 0.0.0.0、公网地址与其他域名仍被拒绝。
 */
function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname.endsWith('.ts.net')) {
    return true;
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const inner = hostname.slice(1, -1);
    const firstHextet = inner.split(':', 1)[0];
    if (firstHextet.length === 0) {
      return false;
    }
    const firstHextetValue = Number.parseInt(firstHextet, 16);
    return firstHextetValue >= 0xfc00 && firstHextetValue <= 0xfdff;
  }
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return NaN;
    }
    return Number(part);
  });
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets as [number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

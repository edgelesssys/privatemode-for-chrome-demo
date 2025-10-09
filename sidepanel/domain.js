// Domain parsing helpers as ES module exports
export function isIPv4(host) {
    const m = String(host || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    for (let i = 1; i <= 4; i++) {
      const n = Number(m[i]);
      if (n < 0 || n > 255) return false;
    }
    return true;
}

export function isIPv6(host) {
    return typeof host === 'string' && host.includes(':');
}

export function getBaseDomain(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return host;
    if (host === 'localhost') return host;
    if (isIPv4(host) || isIPv6(host)) return host;

    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const multi = new Set([
      'co.uk','org.uk','gov.uk','ac.uk','net.uk','me.uk',
      'com.au','net.au','org.au','edu.au',
      'co.jp','ne.jp','or.jp','ac.jp',
      'com.br','net.br','org.br','gov.br',
      'com.ar','net.ar','org.ar'
    ]);
    const lastTwo = parts.slice(-2).join('.');
    const lastThree = parts.slice(-3).join('.');
    if (multi.has(lastTwo)) return parts.slice(-3).join('.');
    if (multi.has(lastThree)) return parts.slice(-4).join('.');
    return parts.slice(-2).join('.');
}

export function parseBaseDomainFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      if (u.hostname) return getBaseDomain(u.hostname);
      return (u.protocol || '').replace(':', '') || null;
    } catch (_) {
      if (typeof urlStr === 'string') {
        if (urlStr.startsWith('chrome://')) return 'chrome';
        if (urlStr.startsWith('edge://')) return 'edge';
        if (urlStr.startsWith('about:')) return 'about';
      }
      return null;
    }
}

export function isTrustedRendererUrl(candidate: string, trustedUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const allowedUrl = new URL(trustedUrl);

    if (allowedUrl.protocol === 'file:') {
      return candidateUrl.href === allowedUrl.href;
    }

    return candidateUrl.origin === allowedUrl.origin;
  } catch {
    return false;
  }
}

export function isAllowedExternalUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') {
      return false;
    }

    if (url.hostname === 'github.com') {
      return url.pathname === '/herdrdev/herdr' || url.pathname.startsWith('/herdrdev/herdr/');
    }

    return url.hostname === 'herdr.dev' || url.hostname === 'www.herdr.dev';
  } catch {
    return false;
  }
}

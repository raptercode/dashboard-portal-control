# Project domains

Open a Web project's **Manage domain** action. Workers have no HTTP domains.

1. Enter a hostname such as `api.example.com` and click **Add**. DNS does not need to be ready yet. URLs, paths and wildcards are not accepted.
2. Configure the displayed A record at your DNS provider. AAAA is optional when an A record is available; use it only if the origin accepts public IPv6 traffic. Values belong to this host, not Vercel. No CNAME target is invented.
3. Click **Verify** on the domain, or **Verify all**. Ready DNS records (including Cloudflare Proxy records) can proceed to Nginx/TLS activation. Existing active domains are retained while new domains remain pending.
4. **Valid Configuration** requires DNS readiness, a working managed proxy and a trusted origin certificate matching the hostname. Certificate expiry is shown separately.

**Refresh** reads DNS and origin status without writing Nginx or requesting a certificate. Verify is an explicit activation action and can be retried after fixing an error. Adding a pending domain does not make later app deployments request a certificate for that domain.

Cloudflare Proxy can remain enabled. Detection is inferred from public IPv4/IPv6 answers in Cloudflare's published ranges; it cannot reveal the hidden origin IP or all other CDN providers. Check the origin target in Cloudflare against the displayed host IP. HTTP-01 validation still needs `/.well-known/acme-challenge/` to reach this host through any redirect, cache and firewall rules. Origin TLS status does not certify the CDN's visitor-facing certificate.

Removing a domain also updates the managed route. If removal fails, saved configuration and the active host route can differ; the dialog retains the error and offers a cleanup retry even after the last domain is removed. The application continues running on its existing port.

This flow follows the add/configure/verify sequence in [Vercel's domain guide](https://vercel.com/docs/domains/working-with-domains/add-a-domain), using this host's DNS and certificates. Redirects, automatic www pairing, wildcard certificates, DNS-provider editing and registrar operations are outside this flow.

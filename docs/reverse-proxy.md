# Reverse Proxy and DNS

Signaturee does not require a fixed hostname. A deployment should choose its own DNS name, for example:

```text
https://signature.example.com
```

The browser application supports same-origin reverse proxy deployments. This is the recommended production topology.

## Recommended topology

```text
Browser
  |
  | HTTPS
  v
signature.example.com
  |
  +-- /, static files  ---> Signaturee frontend :3000
  |
  +-- /api/*           ---> Signaturee backend  :3001
  +-- /health          ---> Signaturee backend  :3001
```

The frontend first tries the current browser origin as its API base. Direct backend access on port 3001 remains a development/fallback path.

## DNS

Create an A or CNAME record for the deployment-specific hostname.

Example:

```text
signature.example.com  -> reverse-proxy.example.com
```

or, when the reverse proxy runs on the Signaturee server itself:

```text
signature.example.com  -> <Signaturee server IP>
```

The repository intentionally does not contain a company-specific DNS name.

## nginx example

```nginx
server {
    listen 443 ssl;
    server_name signature.example.com;

    # TLS certificate configuration belongs here.

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3001/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If nginx is on another host, replace `127.0.0.1` with the Signaturee server address.

## Internal-only deployment

For an internal AD environment, the hostname can exist only in the internal DNS zone. Public DNS is not required unless users must access Signaturee from outside the company network.

## Security

For production:
- prefer HTTPS,
- do not expose port 3001 directly to clients when using the reverse proxy,
- restrict direct access to ports 3000/3001 with the host firewall as appropriate,
- keep `AUTH_REQUIRED=true`,
- use LDAP/AD authentication for employee self-service,
- use local Signaturee accounts for Admin/IT roles.

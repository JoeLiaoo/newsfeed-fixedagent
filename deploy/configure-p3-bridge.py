"""Provision matching local P3 bridge credentials without printing secret values."""
from pathlib import Path
from datetime import datetime, timezone
import os
import secrets
import shutil

SITE = Path('/opt/citic-newsfeed/shared/.env')
HERMES = Path('/opt/hermes-agent/home/.env')


def read(path: Path) -> dict[str, str]:
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if '=' in line and not line.lstrip().startswith('#'))


def update(path: Path, changes: dict[str, str]) -> None:
    suffix = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    shutil.copy2(path, path.with_name(path.name + '.before-p3-' + suffix))
    lines = path.read_text().splitlines()
    found = set()
    output = []
    for line in lines:
        key = line.split('=', 1)[0] if '=' in line and not line.lstrip().startswith('#') else None
        if key in changes:
            output.append(key + '=' + changes[key])
            found.add(key)
        else:
            output.append(line)
    output.extend(key + '=' + value for key, value in changes.items() if key not in found)
    path.write_text('\n'.join(output) + '\n')
    os.chmod(path, 0o600)


def main() -> None:
    site = read(SITE)
    hermes = read(HERMES)
    secret = site.get('P3_BINDING_HMAC_SECRET') or hermes.get('CITIC_P3_BINDING_HMAC_SECRET') or secrets.token_urlsafe(48)
    token = site.get('P3_HERMES_BRIDGE_TOKEN') or hermes.get('CITIC_P3_BRIDGE_TOKEN') or secrets.token_urlsafe(48)
    if len(secret) < 32 or len(token) < 32:
        raise ValueError('Existing P3 credentials are too short; no files changed')
    update(SITE, {
        'P3_BINDING_HMAC_SECRET': secret,
        'P3_HERMES_BRIDGE_TOKEN': token,
        'P3_HERMES_BRIDGE_URL': 'http://host.docker.internal:18765/deliver',
        'P3_GP_SYNC_ENABLED': 'false',
        'P3_NOTIFICATIONS_ENABLED': 'false',
        'P3_DELIVERY_ENABLED': 'false',
    })
    update(HERMES, {
        'CITIC_P3_BINDING_HMAC_SECRET': secret,
        'CITIC_P3_BRIDGE_TOKEN': token,
        'CITIC_P3_API_URL': 'http://127.0.0.1:3000/api/v1/membership/bridge/claim',
        'CITIC_P3_BRIDGE_HOST': '172.17.0.1',
        'CITIC_P3_BRIDGE_PORT': '18765',
        'CITIC_P3_BRIDGE_DB': '/opt/hermes-agent/home/bridge-outbox.sqlite3',
    })
    print('P3 bridge credentials configured; three P3 delivery switches remain false.')


if __name__ == '__main__':
    main()

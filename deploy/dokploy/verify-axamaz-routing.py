"""Exercise the production host/path rules through a temporary real Traefik proxy.

Run from any directory with Docker available. No production secrets or data are used.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


root = Path(__file__).resolve().parents[2]
env = {**os.environ, **{key: "routing-check" for key in (
    "POSTGRES_PASSWORD", "JWT_SECRET", "INTERNAL_PROXY_SECRET",
    "INTEGRATION_ENCRYPTION_KEY", "INITIAL_ADMIN_PASSWORD",
)}}
production = json.loads(run(
    "docker", "compose", "--env-file", "/dev/null", "-f",
    str(root / "deploy/dokploy/axamaz.compose.yml"), "config", "--format", "json", env=env,
))
routers = {
    "marketing": {"rule": "Host(`axamaz.com`)", "priority": 1, "service": "marketing", "entryPoints": ["test"]},
}
for service, router in (("axamaz-panel", "axamaz-panel"), ("axamaz-api", "axamaz-ws")):
    labels = production["services"][service]["labels"]
    routers[router] = {
        "rule": labels[f"traefik.http.routers.{router}.rule"],
        "priority": int(labels[f"traefik.http.routers.{router}.priority"]),
        "service": "panel" if service == "axamaz-panel" else "api",
        "entryPoints": ["test"],
    }

cases = {"marketing": ["/", "/ozellikler", "/fiyatlama", "/bilgi-merkezi/google",
                        "/yasal/gizlilik", "/assets/site.js", "/panel-other", "/apiary", "/ws-other"],
         "panel": ["/login", "/kayit?plan=demo", "/panel", "/panel/kullanicilar",
                   "/api/auth/google/start?mode=login", "/api/auth/google/callback?code=test",
                   "/api/admin/settings/calendar/callback", "/_next/static/chunks/app.js",
                   "/uploads/logo.png", "/downloads/form.pdf", "/appointment/test",
                   "/consent/test", "/invite/test", "/optout", "/bildirimler",
                   "/models/dental/manifest.json", "/models/dental/toothfairy.bin",
                   "/treatment-planning/photos.jpg", "/audio-processor.js",
                   "/saglik-bakanligi-onam-formu.pdf", "/profil", "/shift", "/admin", "/yonetici", "/calisan", "/hekim", "/host"],
         "api": ["/ws", "/ws/", "/ws?session=test"]}

with tempfile.TemporaryDirectory(prefix="axamaz-routing-") as folder:
    folder = Path(folder)
    config = {"http": {"routers": routers, "services": {
        name: {"loadBalancer": {"servers": [{"url": f"http://probe:{port}"}]}}
        for port, name in ((3001, "api"), (3002, "panel"), (3003, "marketing"))
    }}}
    (folder / "routing.yml").write_text(json.dumps(config))
    (folder / "probe.js").write_text('''
for (const [port, service] of [[3001,"api"],[3002,"panel"],[3003,"marketing"]]) {
  Bun.serve({ port, hostname: "0.0.0.0", fetch: request => Response.json({service, path: new URL(request.url).pathname}) });
}
''')
    compose = {"services": {
        "probe": {"image": "oven/bun:1-alpine", "command": ["bun", "/probe.js"],
                  "volumes": [f"{folder}/probe.js:/probe.js:ro"]},
        "edge": {"image": "traefik:v3", "command": ["--entrypoints.test.address=:8080",
                 "--providers.file.filename=/etc/traefik/routing.yml"],
                 "ports": ["127.0.0.1::8080"], "volumes": [f"{folder}/routing.yml:/etc/traefik/routing.yml:ro"]},
    }}
    path = folder / "compose.json"
    path.write_text(json.dumps(compose))
    command = ["docker", "compose", "-p", f"axamaz-routing-{os.getpid()}", "-f", str(path)]
    try:
        subprocess.run([*command, "up", "-d"], check=True)
        address = run(*command, "port", "edge", "8080")
        base = f"http://{address}"
        for attempt in range(60):
            try:
                with urlopen(Request(base + "/", headers={"Host": "axamaz.com"}), timeout=2) as response:
                    if json.load(response)["service"] == "marketing":
                        break
            except (URLError, ConnectionError, json.JSONDecodeError):
                time.sleep(0.5)
        else:
            raise RuntimeError("Temporary routing proxy did not become ready")
        count = 0
        for expected, paths in cases.items():
            for target in paths:
                with urlopen(Request(base + target, headers={"Host": "axamaz.com"}), timeout=5) as response:
                    actual = json.load(response)
                assert actual["service"] == expected, (target, expected, actual)
                assert actual["path"] == target.split("?", 1)[0], ("Path changed", target, actual)
                count += 1
        try:
            urlopen(Request(base + "/panel", headers={"Host": "unrelated.example"}), timeout=5)
            raise AssertionError("Panel routing accepted an unrelated host")
        except HTTPError as error:
            assert error.code == 404, error.code
        print(f"PASS: {count} paths kept on axamaz.com with correct services and unchanged paths; unrelated host rejected.")
    finally:
        subprocess.run([*command, "down", "--remove-orphans"], check=True)

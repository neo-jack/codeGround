#!/bin/sh
set -eu

: "${CODEGROUND_IMAGE:?CODEGROUND_IMAGE is required}"
: "${GHCR_USER:?GHCR_USER is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"

# Keep the existing runtime identities and certificate volume during migration.
name=102my-react-playground
previous=102my-react-playground-previous
gateway=react-playground-https
network=deploy_playground
root="${CODEGROUND_ROOT:-/opt/react-playground}"
caddyfile="$root/deploy/Caddyfile"
saved=false
created=false
gateway_changed=false
committed=false
temp=$(mktemp -d)
extract="codeground-extract-$$"

finish() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$committed" = false ]; then
        if [ "$created" = true ]; then docker rm -f "$name" || true; fi
        if [ "$saved" = true ]; then
            docker rename "$previous" "$name" || true
            docker start "$name" || true
        fi
        if [ "$gateway_changed" = true ]; then
            cat "$temp/Caddyfile.previous" > "$caddyfile"
            docker restart "$gateway" || true
        fi
    fi
    docker rm "$extract" >/dev/null 2>&1 || true
    rm -rf "$temp"
    exit "$result"
}
trap finish EXIT
trap 'exit 143' HUP INT TERM

if docker container inspect "$previous" >/dev/null 2>&1; then
    echo 'Unresolved Codeground rollback backup exists.' >&2
    exit 1
fi
test -s "$caddyfile"
docker container inspect "$name" >/dev/null
docker container inspect "$gateway" >/dev/null
docker network inspect "$network" >/dev/null
printf '%s' "$GHCR_TOKEN" | docker --config "$temp" login ghcr.io -u "$GHCR_USER" --password-stdin
docker --config "$temp" pull "$CODEGROUND_IMAGE"
# Validate project registry and image before touching the live container.
docker run --rm --network none "$CODEGROUND_IMAGE" python -c 'import server; assert server.CONFIG["projects"]'
docker create --name "$extract" "$CODEGROUND_IMAGE" >/dev/null
docker cp "$extract:/app/deploy/Caddyfile" "$temp/Caddyfile"
docker cp "$temp/Caddyfile" "$gateway:/tmp/codeground-Caddyfile"
docker exec "$gateway" caddy validate --config /tmp/codeground-Caddyfile --adapter caddyfile
cp "$caddyfile" "$temp/Caddyfile.previous"

docker rename "$name" "$previous"
saved=true
docker stop "$previous"
docker create --name "$name" --restart=unless-stopped \
    --network "$network" --network-alias playground \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --memory 128m --memory-swap 128m --cpus 0.5 --pids-limit 48 \
    --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 \
    "$CODEGROUND_IMAGE"
created=true
docker start "$name"
attempt=0
while [ "$attempt" -lt 30 ]; do
    state=$(docker inspect --format '{{.State.Health.Status}}' "$name")
    [ "$state" != unhealthy ] || exit 1
    [ "$state" != healthy ] || break
    attempt=$((attempt + 1))
    sleep 2
done
[ "$state" = healthy ] || exit 1
docker exec "$name" python -c 'import server,urllib.request; paths=list(server.ROUTES); assert paths; [urllib.request.urlopen("http://127.0.0.1:8091"+p+"/",timeout=5) for p in paths]'
gateway_changed=true
# Truncate rather than rename: the gateway has a bind mount to this inode.
cat "$temp/Caddyfile" > "$caddyfile"
docker restart "$gateway"
attempt=0
until docker exec "$gateway" wget -q -O /dev/null http://playground:8091/healthz; do
    attempt=$((attempt + 1)); [ "$attempt" -lt 15 ] || exit 1
    sleep 2
done

committed=true
docker rm "$previous"
# Allow subsequent manual compose operations to keep the deployed CI image.
touch "$root/deploy/.env"
sed '/^CODEGROUND_IMAGE=/d' "$root/deploy/.env" > "$temp/runtime.env"
printf 'CODEGROUND_IMAGE=%s\n' "$CODEGROUND_IMAGE" >> "$temp/runtime.env"
cat "$temp/runtime.env" > "$root/deploy/.env"
chmod 600 "$root/deploy/.env"
echo 'Codeground deployment is healthy.'

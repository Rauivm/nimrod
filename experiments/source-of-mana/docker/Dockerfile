FROM debian:bookworm-slim AS tools
ARG GODOT_VERSION=4.7.1
ENV GODOT_SILENCE_ROOT_WARNING=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip libfontconfig1 libgl1 libasound2 \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    base="https://github.com/godotengine/godot-builds/releases/download/${GODOT_VERSION}-stable"; \
    file="Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip"; \
    cd /tmp; \
    curl --fail --silent --show-error --location --retry 3 "$base/$file" -o "$file"; \
    curl --fail --silent --show-error --location --retry 3 "$base/SHA512-SUMS.txt" -o SHA512-SUMS.txt; \
    grep " $file\$" SHA512-SUMS.txt | sha512sum --check; \
    unzip "$file" -d /usr/local/bin; \
    mv "/usr/local/bin/Godot_v${GODOT_VERSION}-stable_linux.x86_64" /usr/local/bin/godot; \
    rm "$file" SHA512-SUMS.txt
RUN useradd --create-home --uid 1000 mana && mkdir /data && chown mana:mana /data

FROM tools AS imported
COPY --chown=mana:mana game/ /opt/mana/
COPY --chown=mana:mana integration/ /opt/mana/sources/integration/
COPY --chown=mana:mana verification/ /opt/mana/verification/
USER mana
WORKDIR /opt/mana
RUN godot --headless --path /tmp --script /opt/mana/sources/integration/BuildMinimap.gd -- \
    /opt/mana/data/maps/nimrod/floorplan.json "/opt/mana/data/graphics/minimaps/nimrod/Nimrod Tavern.png"
RUN godot --headless --editor --import --quit > /tmp/mana-import.log 2>&1 \
    && cat /tmp/mana-import.log \
    && ! grep -E 'SCRIPT ERROR|Parse Error|Compile Error' /tmp/mana-import.log

FROM imported AS server
ENV XDG_DATA_HOME=/data
EXPOSE 6118/tcp 6119/udp
CMD ["godot", "--headless", "--path", "/opt/mana", "--server"]

FROM tools AS templates
ARG GODOT_VERSION=4.7.1
RUN --mount=type=cache,target=/var/cache/godot set -eux; \
    base="https://github.com/godotengine/godot-builds/releases/download/${GODOT_VERSION}-stable"; \
    file="Godot_v${GODOT_VERSION}-stable_export_templates.tpz"; \
    cd /var/cache/godot; \
    curl --fail --silent --show-error --location --retry 5 --retry-all-errors --connect-timeout 20 --max-time 900 "$base/SHA512-SUMS.txt" -o SHA512-SUMS.txt; \
    if ! grep " $file\$" SHA512-SUMS.txt | sha512sum --check --status 2>/dev/null; then \
        curl --fail --silent --show-error --location --retry 5 --retry-all-errors --connect-timeout 20 --max-time 900 "$base/$file" -o "$file"; \
    fi; \
    grep " $file\$" SHA512-SUMS.txt | sha512sum --check; \
    mkdir -p "/templates/${GODOT_VERSION}.stable"; \
    unzip -j "$file" 'templates/web*.zip' templates/version.txt -d "/templates/${GODOT_VERSION}.stable"

FROM imported AS exported
COPY --from=templates --chown=mana:mana /templates/ /home/mana/.local/share/godot/export_templates/
RUN mkdir /opt/mana/web && godot --headless --export-release Web /opt/mana/web/index.html

FROM nginx:alpine AS web
ENV MANA_WS_HOST=mana-server
COPY --from=exported /opt/mana/web/ /usr/share/nginx/html/
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

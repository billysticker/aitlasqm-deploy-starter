# Sandbox layer: QM supplies Node 24; this adds only the scoped gateway client.
FROM ghcr.io/yc-software/qm/sandbox-base@sha256:52cb44a6e9d166da20638c8ce55e3f423384f5557eba49915684cb8ed16e5873

COPY skills/aitlasqm-composio/scripts/composio /usr/local/bin/composio
RUN chmod a+rx /usr/local/bin/composio && composio --version

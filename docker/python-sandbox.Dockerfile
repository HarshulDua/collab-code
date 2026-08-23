# Minimal, locked-down image used ONLY to run untrusted user code.
# No shell tools beyond what python3 itself needs, no network at runtime
# (enforced by the container's NetworkMode: none at creation time),
# and code always runs as the unprivileged "sandbox" user.
FROM python:3.11-alpine

RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

USER sandbox
WORKDIR /home/sandbox

ENTRYPOINT []

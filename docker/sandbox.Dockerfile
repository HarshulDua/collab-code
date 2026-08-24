FROM python:3.11-alpine

RUN apk add --no-cache nodejs npm build-base go rust cargo openjdk17-jdk mono \
    && npm install -g typescript

# Each execution runs in a fresh, throwaway container (by design — no state
# should persist between untrusted runs), which means GOCACHE starts cold
# every single time: `go build` on even a one-line "hello world" has to
# compile the fmt/os/reflect/etc. dependency graph from scratch first,
# costing 20+ seconds before the user's own code ever runs. Baking a warm
# cache into the image (seeded here, copied into the writable /build tmpfs
# at runtime by goRunner.js) means runtime `go build` only has to compile
# the user's own file against already-built stdlib archives.
RUN mkdir -p /opt/go-cache-seed /tmp/go-warm && \
    printf 'package main\nimport "fmt"\nfunc main() { fmt.Println("warm") }\n' > /tmp/go-warm/warm.go && \
    GOCACHE=/opt/go-cache-seed GOPATH=/tmp/go-warm-path GOTMPDIR=/tmp/go-warm \
      go build -o /tmp/go-warm/warm /tmp/go-warm/warm.go && \
    rm -rf /tmp/go-warm /tmp/go-warm-path && \
    chmod -R a+rX /opt/go-cache-seed

RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

USER sandbox
WORKDIR /home/sandbox

ENTRYPOINT []

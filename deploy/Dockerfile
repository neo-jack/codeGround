FROM python:3.12-alpine
RUN apk add --no-cache git ca-certificates && adduser -D -u 10001 playground
WORKDIR /app
COPY server.py projects.json ./
COPY deploy/Caddyfile.site /app/deploy/Caddyfile
COPY dist/ ./dist/
USER 10001:10001
EXPOSE 8091
HEALTHCHECK --interval=5s --timeout=4s --start-period=10s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/healthz', timeout=3)"
CMD ["python", "-B", "server.py"]

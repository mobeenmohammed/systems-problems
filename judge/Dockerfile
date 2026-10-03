# The judge: g++, rustc, python3 and node in one image.
#
# Based on the official Rust image because getting a current rustc any other
# way means running rustup at build time; this already has it, and it is built
# on buildpack-deps so g++ and the sanitizer runtimes are present too.
#
# Node comes from Debian rather than NodeSource: the server is node:http,
# node:fs and child_process, so Debian's version is more than enough and it
# keeps the build to one apt call with no extra keyring.
FROM rust:1-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      nodejs \
      util-linux \
  && rm -rf /var/lib/apt/lists/*

# Runs as a normal user. Submitted code is yours, but there is no reason for it
# to run as root inside the container either, and a non-root user means a stray
# write cannot touch the toolchain.
RUN useradd --create-home --shell /bin/bash judge
WORKDIR /judge
COPY --chown=judge:judge languages.mjs server.mjs ./
USER judge

# A writable scratch for the per-request temp directories.
ENV TMPDIR=/tmp
ENV JUDGE_PORT=2000
EXPOSE 2000

# Reports which languages actually came up, so a broken image is obvious from
# `docker compose logs` rather than from a failed submission.
CMD ["node", "server.mjs"]

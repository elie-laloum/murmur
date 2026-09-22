# Isolation and operational boundaries

## What the built-in provider isolates

The agent receives a writable independent checkout at `/workspace`, writable temporary directories and an otherwise read-only Linux root filesystem. It runs under a non-root UID/GID, with capabilities dropped, no-new-privileges, bounded memory/CPU and a process-count limit. Host home, source repository and daemon socket are not mounted.

This is container isolation, not a VM or a hardened multi-tenant service. Use a dedicated worker for hostile workloads. Docker host administrators retain control over containers and can inspect credentials supplied to a command.

Network access defaults to bridge mode because provider APIs and package installation need it. This does not restrict outbound destinations or block access to services reachable from the container. Choose `network: "none"` for offline tasks or implement a provider with an egress policy. No domain allowlist is implied.

CPU/memory/pid limits apply to the whole chamber. Temporary volumes have size limits; the checkout bind mount does not. Apply host filesystem quotas if a workload can fill disk. Logs stop after 8 MiB of captured output and terminate the command/container.

## Credential handling

Credentials are supplied per command through environment variable names to the container CLI; their values are not part of its argv. The library does not load `.env` or mount existing host provider sessions automatically. The example uses Node's `--env-file` explicitly.

Inside the container, an agent and its children can read the credentials passed to them. Repository code running in that request can also read them. Do not forward unrelated secrets. Returned raw transcripts and generated files may contain sensitive data; sanitize before publishing.

## Host execution

Workflow callbacks and custom drivers/providers are trusted JavaScript in the host process. Murmur only isolates commands sent through a chamber. A task that directly calls Node's filesystem or child-process APIs is host code.

Agent modifications to `.git/config` cannot control patch export: export uses separate unmounted metadata. Git global/system configuration, hooks and external diff/text-conversion commands are disabled for those operations. Source repositories themselves are trusted inputs to Git; Murmur is not a Git vulnerability mitigation system.

## Lifecycle

Do not abandon an unawaited `chamber()` call. Use `await using` or `try/finally`. `close()` drains already accepted requests before deleting the container. To interrupt a long-running request, abort its signal first.

Cancellation, timeout, output overflow or an output callback exception destroys the built-in container to stop descendant processes. That chamber cannot be used afterward. This prevents an orphaned `docker exec` child from continuing work after the host command exits. Ordinary nonzero exits leave the chamber alive.

If the container daemon is unreachable, cleanup can fail. The error is reported and disposal may be retried. Inspect containers whose names start with `murmur-` after daemon failures or a host process crash. No background daemon or global janitor runs on your behalf.

Workspaces are kept under the OS temp directory. They can contain generated secrets and session artifacts copied by an agent. Export what you need and remove the retained `murmur-*` directory when done. Their persistence is not guaranteed across OS cleanup or restarts.

## Platform notes

The Node library is tested on Windows, Linux and macOS. The built-in isolation runs Linux containers. On Linux, the container UID/GID must be able to write the host checkout. Rootless Podman UID mappings and SELinux policies differ by host; this initial provider does not add relabel flags or change host ownership. Use a custom provider when those policies require specialized configuration.

Submodules are not initialized and Git LFS objects are not fetched automatically. Images are not pulled automatically. Remote Docker daemon bind mounts are outside the supported configuration.

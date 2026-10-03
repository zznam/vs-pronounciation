# Manual local GitHub Actions runner

This repository can use the manually started Linux x64 runner on the configured Mac. Docker Desktop runs a fresh Ubuntu 24.04 container for each job.

`LOCAL_RUNNER_LABELS` is a repository Actions variable containing `["self-hosted","Linux","X64","zznam-local-linux"]`. Clearing it restores each job's original GitHub-hosted runner. Pull requests from forks also keep their original hosted runner. Windows, macOS, pinned older Linux images, custom runner policies, and jobs requiring Docker services or a Docker daemon retain their existing routing.

Start one job:

```bash
python3 ~/.local/share/github-actions/zznam/runners.py start vs-pronounciation
```

For a pipeline with several jobs, keep the manual launcher open until you stop it:

```bash
python3 ~/.local/share/github-actions/zznam/runners.py start vs-pronounciation --jobs 0
```

Each runner is registered only for this repository and automatically deregisters after one job. The next job uses a new container. No background service, host folder, host credentials, Docker socket, privileged container, or host network is used. Workflow tokens and repository secrets still follow the existing workflow permissions. The Mac must be awake and Docker Desktop running; otherwise local jobs wait in the queue.

The launcher and image are installed at `~/.local/share/github-actions/zznam` on this Mac. They use GitHub CLI authentication on the host only to obtain a short-lived runner registration token, passed to the container through standard input. This setup does not install a complete GitHub-hosted tool image; jobs should install their language toolchains through setup actions.

See [GitHub's self-hosted runner documentation](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) for installation on another machine. This change only adjusts job routing; build, test, deployment commands, permissions, triggers, and matrix definitions are preserved.

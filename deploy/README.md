# Deploying alias-x to the GCP VM

The workflow in `.github/workflows/ci-deploy.yml` runs typecheck and tests on every pull request.
On every push to `main` it also deploys to the VM: it sends a `git archive` of that commit over SSH
to `deploy/alias-x-deploy.sh`, which backs up the database, installs the new version beside the
live one, swaps, restarts, health-checks `/health`, and rolls back automatically if the check fails.

The SSH key used by GitHub can do exactly one thing: run the deploy script. It cannot open a shell.

## One-time setup

### 1. Key pair (repo owner, on their own computer)
```
ssh-keygen -t ed25519 -f alias-x-deploy-key -N "" -C github-actions-alias-x
```
Only the public key (`alias-x-deploy-key.pub`) is ever shared. The private key goes straight into
the GitHub secret and is then deleted from the computer.

### 2. VM (SSH-in-browser window)
Upload `deploy/alias-x-deploy.sh` with UPLOAD FILE, then:
```
sudo install -o root -g root -m 755 ~/alias-x-deploy.sh /usr/local/bin/alias-x-deploy
sudo adduser --disabled-password --gecos "" deploy
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/alias-x-deploy' | sudo tee /etc/sudoers.d/alias-x-deploy
sudo chmod 440 /etc/sudoers.d/alias-x-deploy
sudo visudo -cf /etc/sudoers.d/alias-x-deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
```
Then add the public key. Replace `PASTE_PUBLIC_KEY_LINE` with the full contents of the `.pub` file:
```
echo 'restrict,command="sudo /usr/local/bin/alias-x-deploy" PASTE_PUBLIC_KEY_LINE' | sudo tee /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

### 3. Host key (so GitHub knows it is talking to the real VM)
On the VM: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
On any computer: `ssh-keyscan -t ed25519 alias-x.devxlabs.ai | tee /dev/stderr | ssh-keygen -lf -`
The two fingerprints must match. The `ssh-keyscan` line (starting with the hostname) is the value for
`DEPLOY_KNOWN_HOSTS`.

### 4. GitHub secrets (Settings > Secrets and variables > Actions)
| Name | Value |
|---|---|
| `DEPLOY_HOST` | `alias-x.devxlabs.ai` |
| `DEPLOY_SSH_KEY` | the private key file contents |
| `DEPLOY_KNOWN_HOSTS` | the `ssh-keyscan` line from step 3 |

Optional: Settings > Environments > `production` > Required reviewers, to approve each deploy.

### 5. Test it by hand before relying on GitHub
From a clone of the repo (this runs a real deploy of the commit you name, so use a commit that is safe):
```
SHA=$(git rev-parse HEAD)
git archive --format=tar.gz --output=/tmp/release.tar.gz "$SHA"
{ echo "$SHA"; cat /tmp/release.tar.gz; } | ssh -i alias-x-deploy-key -o IdentitiesOnly=yes deploy@alias-x.devxlabs.ai
```
Expect the five numbered steps and `healthy: <sha>`.

## Things to know
- Previous version is kept in `/opt/alias-x.prev`; a failed version is kept in `/opt/alias-x.failed`.
- Manual rollback: `sudo systemctl stop alias-x; sudo mv /opt/alias-x /opt/alias-x.bad; sudo mv /opt/alias-x.prev /opt/alias-x; sudo systemctl start alias-x`
- Keep database migrations additive so a rollback to the old code still works.
- This uses GitHub-hosted runners and SSH on port 22. If SSH is later restricted on the VPC, run the deploy job on a self-hosted runner in the same project instead.
- The Cloudflare `npm run deploy` is not part of this workflow.

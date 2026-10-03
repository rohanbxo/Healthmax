#!/usr/bin/env bash
# Provisions the AWS resources Beta expects (S3 export bucket, SES sender
# identity) inside Floci, the local AWS emulator. Run by the one-shot
# `aws-init` service in docker-compose.yml, and by CI against a Floci service
# container.
#
# The endpoint is never hardcoded: AWS CLI v2 reads AWS_ENDPOINT_URL natively,
# so compose points it at http://floci:4566 and CI at http://localhost:4566.
#
# Idempotent: Floci's state is disposable and this runs on every `compose up`,
# so every step either checks first or is a put that overwrites.
set -euo pipefail

bucket="${S3_EXPORT_BUCKET:-beta-exports}"

# Readiness is the caller's job (compose waits for Floci's healthcheck), but a
# freshly healthy container can still drop the very first request, so give the
# first call a few tries rather than failing the whole stack on it.
for attempt in 1 2 3 4 5; do
  if aws s3api list-buckets >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = 5 ]; then
    echo "Floci at ${AWS_ENDPOINT_URL:-<default endpoint>} is not answering" >&2
    exit 1
  fi
  sleep 2
done

# 1. Export bucket.
if aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  echo "Bucket $bucket already exists"
else
  echo "Creating bucket $bucket"
  aws s3api create-bucket --bucket "$bucket" >/dev/null
fi

# 2. Exports are private, presigned-URL only: block every form of public access,
#    as the real bucket does.
aws s3api put-public-access-block --bucket "$bucket" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 3. Exports are short-lived; expire them after a day. Not every emulator
#    implements lifecycle rules, and nothing local depends on expiry, so a
#    failure here is a warning rather than a broken stack.
lifecycle='{"Rules":[{"ID":"expire-exports","Status":"Enabled","Filter":{"Prefix":"exports/"},"Expiration":{"Days":1}}]}'
if aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" \
  --lifecycle-configuration "$lifecycle" >/dev/null; then
  echo "Lifecycle rule set: exports/ expires after 1 day"
else
  echo "WARNING: could not set the lifecycle rule on $bucket; continuing without it" >&2
fi

# 4. SES only sends from verified identities. EMAIL_FROM may be
#    `Name <addr@host>` or a bare `addr@host`; SES wants the bare address.
email_from="${EMAIL_FROM:-}"
if [ -z "$email_from" ]; then
  echo "EMAIL_FROM is empty; skipping SES identity verification"
else
  address="$email_from"
  if [[ "$email_from" =~ \<([^>]+)\> ]]; then
    address="${BASH_REMATCH[1]}"
  fi
  # Trim surrounding whitespace.
  address="${address#"${address%%[![:space:]]*}"}"
  address="${address%"${address##*[![:space:]]}"}"
  echo "Verifying SES identity $address"
  aws ses verify-email-identity --email-address "$address"
fi

# 5. Summary.
echo "--- S3 buckets ---"
aws s3 ls
echo "--- SES identities ---"
aws ses list-identities --output text

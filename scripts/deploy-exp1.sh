#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-sycamore-labs-exp1}"
REGION="${REGION:-us-west1}"
SERVICE_NAME="${SERVICE_NAME:-meeting-v2}"
INSTANCE_CONNECTION_NAME="${INSTANCE_CONNECTION_NAME:-sycamore-labs-exp1:us-west1:meeting-v2-exp1-postgres}"
RUN_SERVICE_ACCOUNT="meeting-v2-api@${PROJECT_ID}.iam.gserviceaccount.com"
SIGNING_SERVICE_ACCOUNT="${GCS_SIGNING_SERVICE_ACCOUNT:-meeting-v2-audio-signer@${PROJECT_ID}.iam.gserviceaccount.com}"

if [[ "${PROJECT_ID}" != "sycamore-labs-exp1" ]]; then
  echo "Refusing to deploy outside sycamore-labs-exp1." >&2
  exit 1
fi

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required." >&2
    exit 1
  fi
}

require_env DATABASE_URL
require_env OPENAI_API_KEY
require_env AUDIO_BUCKET_NAME
require_env GCS_SIGNING_SERVICE_ACCOUNT
require_env MEETING_AUTH_SECRET
require_env MEETING_APP_PASSWORD

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  iamcredentials.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud iam service-accounts describe "${RUN_SERVICE_ACCOUNT}" \
  --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create meeting-v2-api \
    --project "${PROJECT_ID}" \
    --display-name "Meeting v2 API"
fi

for _ in {1..20}; do
  if gcloud iam service-accounts describe "${RUN_SERVICE_ACCOUNT}" \
    --project "${PROJECT_ID}" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${RUN_SERVICE_ACCOUNT}" \
  --role roles/cloudsql.client \
  --condition=None >/dev/null

gcloud iam service-accounts add-iam-policy-binding "${SIGNING_SERVICE_ACCOUNT}" \
  --project "${PROJECT_ID}" \
  --member "serviceAccount:${RUN_SERVICE_ACCOUNT}" \
  --role roles/iam.serviceAccountTokenCreator >/dev/null

cloud_sql_database_url="$(
  INSTANCE_CONNECTION_NAME="${INSTANCE_CONNECTION_NAME}" node <<'NODE'
const input = process.env.DATABASE_URL;
const connectionName = process.env.INSTANCE_CONNECTION_NAME;
const url = new URL(input);
const user = encodeURIComponent(decodeURIComponent(url.username));
const password = encodeURIComponent(decodeURIComponent(url.password));
const database = url.pathname.replace(/^\//, "");
process.stdout.write(
  `postgresql://${user}:${password}@/${database}?host=/cloudsql/${connectionName}`
);
NODE
)"

ensure_secret() {
  local name="$1"
  local value="$2"

  if gcloud secrets describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    printf "%s" "${value}" | gcloud secrets versions add "${name}" \
      --project "${PROJECT_ID}" \
      --data-file=- >/dev/null
  else
    printf "%s" "${value}" | gcloud secrets create "${name}" \
      --project "${PROJECT_ID}" \
      --replication-policy=automatic \
      --data-file=- >/dev/null
  fi

  gcloud secrets add-iam-policy-binding "${name}" \
    --project "${PROJECT_ID}" \
    --member "serviceAccount:${RUN_SERVICE_ACCOUNT}" \
    --role roles/secretmanager.secretAccessor \
    --condition=None >/dev/null
}

ensure_secret meeting-v2-database-url "${cloud_sql_database_url}"
ensure_secret meeting-v2-openai-api-key "${OPENAI_API_KEY}"
ensure_secret meeting-v2-auth-secret "${MEETING_AUTH_SECRET}"
ensure_secret meeting-v2-app-password "${MEETING_APP_PASSWORD}"

gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --quiet \
  --source . \
  --service-account "${RUN_SERVICE_ACCOUNT}" \
  --add-cloudsql-instances "${INSTANCE_CONNECTION_NAME}" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},AUDIO_BUCKET_NAME=${AUDIO_BUCKET_NAME},GCS_SIGNING_SERVICE_ACCOUNT=${GCS_SIGNING_SERVICE_ACCOUNT},MEETING_APP_USER_ID=${MEETING_APP_USER_ID:-app_user},MEETING_APP_USER_NAME=${MEETING_APP_USER_NAME:-Meeting User},OPENAI_SUMMARY_MODEL=${OPENAI_SUMMARY_MODEL:-gpt-5.5}" \
  --set-secrets "DATABASE_URL=meeting-v2-database-url:latest,OPENAI_API_KEY=meeting-v2-openai-api-key:latest,MEETING_AUTH_SECRET=meeting-v2-auth-secret:latest,MEETING_APP_PASSWORD=meeting-v2-app-password:latest" \
  --allow-unauthenticated

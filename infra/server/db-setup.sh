#!/usr/bin/env bash
# Creates the PostgreSQL role and database. Usage: ./db-setup.sh '<password: letters and digits only>'
set -euo pipefail
PASSWORD="${1:?usage: db-setup.sh <password>}"
sudo -u postgres psql -c "CREATE USER lifetime WITH PASSWORD '${PASSWORD}';" -c "CREATE DATABASE lifetime OWNER lifetime;"

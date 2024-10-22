#!/usr/bin/env bash

set -e

if [ -z $GITHUB_WORKSPACE ]
then
    GITHUB_WORKSPACE="$(dirname "$(dirname "$(realpath "$0")")")"
fi

if [ -z $GITHUB_REPOSITORY ]
then
    GITHUB_REPOSITORY="skalenetwork/skale-manager"
fi

export NVM_DIR=~/.nvm;
source $NVM_DIR/nvm.sh;

DEPLOYED_TAG=$(cat $GITHUB_WORKSPACE/DEPLOYED)
DEPLOYED_VERSION=$(echo $DEPLOYED_TAG | xargs ) # trim
DEPLOYED_DIR=$GITHUB_WORKSPACE/deployed-skale-manager/

DEPLOYED_WITH_NODE_VERSION="lts/hydrogen"
CURRENT_NODE_VERSION=$(nvm current)

git clone --branch $DEPLOYED_TAG https://github.com/$GITHUB_REPOSITORY.git $DEPLOYED_DIR

# Have to set --miner.blockTime 1
# because there is a bug in ganache
# https://github.com/trufflesuite/ganache/issues/4165
# TODO: remove --miner.blockTime 1
# when ganache processes pending queue correctly
# to speed up testing process
GANACHE_SESSION=$(npx ganache --😈 --miner.blockGasLimit 8000000 --miner.blockTime 1)

cd $DEPLOYED_DIR
nvm install $DEPLOYED_WITH_NODE_VERSION
nvm use $DEPLOYED_WITH_NODE_VERSION
yarn install

PRODUCTION=true VERSION=$DEPLOYED_VERSION npx hardhat run migrations/deploy.ts --network localhost
rm $GITHUB_WORKSPACE/.openzeppelin/unknown-*.json || true
cp .openzeppelin/unknown-*.json $GITHUB_WORKSPACE/.openzeppelin
CONTRACTS_FILENAME="skale-manager-$DEPLOYED_VERSION-localhost-contracts.json"
# TODO: copy contracts.json file when deployed version starts supporting it
# cp "data/$CONTRACTS_FILENAME" "$GITHUB_WORKSPACE/data"
ABI_FILENAME="skale-manager-$DEPLOYED_VERSION-localhost-abi.json"
cp "data/$ABI_FILENAME" "$GITHUB_WORKSPACE/data"

cd $GITHUB_WORKSPACE
nvm use $CURRENT_NODE_VERSION
rm -r --interactive=never $DEPLOYED_DIR

# TODO: use contracts.json file when deployed version starts supporting it
# SKALE_MANAGER_ADDRESS=$(cat data/$CONTRACTS_FILENAME | jq -r .SkaleManager)
SKALE_MANAGER_ADDRESS=$(cat data/$ABI_FILENAME | jq -r .skale_manager_address)
export ALLOW_NOT_ATOMIC_UPGRADE="OK"
export TARGET="$SKALE_MANAGER_ADDRESS"
export UPGRADE_ALL=true
# TODO: Remove after release 1.12.0
export IMA="$SKALE_MANAGER_ADDRESS"
export MARIONETTE="$SKALE_MANAGER_ADDRESS"
export PAYMASTER="$SKALE_MANAGER_ADDRESS"
# End of TODO
npx hardhat run migrations/upgrade.ts --network localhost

npx ganache instances stop $GANACHE_SESSION

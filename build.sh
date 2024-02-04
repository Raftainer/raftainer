#!/bin/bash
set -e

IMAGE=500518139216.dkr.ecr.us-east-1.amazonaws.com/raftainer-core
TAG=`cat package.json | jq -r '.version'`

docker build -t $IMAGE:$TAG .
docker push $IMAGE:$TAG

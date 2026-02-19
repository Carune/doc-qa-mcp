# API Operations Guide

Follow these rules to reduce incidents:

1. Watch error rate closely for 10 minutes right after deployment.
2. Keep database connection usage below pool limits.
3. Set timeout and retry policy for all external API calls.

During traffic spikes, use read cache first and buffer write requests in a queue.

/**
 * Slack Notification Service
 * Sends Block Kit messages to Slack webhooks
 */

import axios from 'axios';
import logger from '../utils/logger.js';

// Block Kit color attachments
const COLORS = {
    success: '#36a64f',
    error: '#ff0000',
    warning: '#ffcc00',
    info: '#3aa3e3',
};

/**
 * Send a notification to Slack webhook
 * @param {object} data - Notification data
 * @param {string} type - Notification type ('success', 'error', 'warning', 'info')
 * @returns {Promise<{success: boolean}>}
 */
export async function sendSlackNotification(data, type = 'success') {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
        logger.debug('Slack webhook URL not configured, skipping notification');
        return { success: false, reason: 'No webhook URL' };
    }

    try {
        const message = buildSlackMessage(data, type);

        await axios.post(webhookUrl, message, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });

        logger.info('Slack notification sent', { type, eventId: data.eventId });
        return { success: true };
    } catch (error) {
        logger.error('Failed to send Slack notification', {
            error: error.message,
            status: error.response?.status,
        });
        return { success: false, error: error.message };
    }
}

/**
 * Build Slack Block Kit message
 * @param {object} data - Notification data
 * @param {string} type - Notification type
 * @returns {object} Slack message payload
 */
function buildSlackMessage(data, type) {
    const color = COLORS[type] || COLORS.info;

    // Handle error notifications
    if (data.isFailure) {
        return buildErrorMessage(data, color);
    }

    // Handle PR created
    if (data.prUrl) {
        return buildPRMessage(data, color);
    }

    // Handle issue created (manual review)
    if (data.issueUrl) {
        return buildIssueMessage(data, color);
    }

    // Generic message
    return buildGenericMessage(data, color);
}

/**
 * Build message for successful PR creation
 */
function buildPRMessage(data, color) {
    return {
        attachments: [
            {
                color,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '✅ CodeAutopsy: Fix Deployed',
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        fields: [
                            {
                                type: 'mrkdwn',
                                text: `*Repository:*\n${data.repoFullName}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Branch:*\n${data.branch || 'main'}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Error Type:*\n${data.errorType || 'Unknown'}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Confidence:*\n${data.confidence ? `${(data.confidence * 100).toFixed(0)}%` : 'N/A'}`,
                            },
                        ],
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*File Fixed:*\n\`${data.filePath}\``,
                        },
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: `View PR #${data.prNumber}`,
                                    emoji: true,
                                },
                                url: data.prUrl,
                                style: 'primary',
                            },
                        ],
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: '🤖 *CodeAutopsy AI Agent*',
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

/**
 * Build message for issue creation (manual review)
 */
function buildIssueMessage(data, color) {
    return {
        attachments: [
            {
                color: COLORS.warning,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '⚠️ CodeAutopsy: Manual Review Required',
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'A build failure was detected but the auto-fix confidence is too low. Please review manually.',
                        },
                    },
                    {
                        type: 'section',
                        fields: [
                            {
                                type: 'mrkdwn',
                                text: `*Repository:*\n${data.repoFullName}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Branch:*\n${data.branch || 'main'}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Error Type:*\n${data.errorType || 'Unknown'}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Confidence:*\n${data.confidence ? `${(data.confidence * 100).toFixed(0)}%` : 'N/A'}`,
                            },
                        ],
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*File:*\n\`${data.filePath}\``,
                        },
                    },
                    {
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: `View Issue #${data.issueNumber}`,
                                    emoji: true,
                                },
                                url: data.issueUrl,
                            },
                        ],
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: '🤖 *CodeAutopsy AI Agent*',
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

/**
 * Build message for processing errors
 */
function buildErrorMessage(data, color) {
    return {
        attachments: [
            {
                color: COLORS.error,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: '❌ CodeAutopsy: Processing Failed',
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'Failed to automatically fix the build failure.',
                        },
                    },
                    {
                        type: 'section',
                        fields: [
                            {
                                type: 'mrkdwn',
                                text: `*Repository:*\n${data.repoFullName}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Branch:*\n${data.branch || 'unknown'}`,
                            },
                        ],
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Error:*\n\`\`\`${data.error || 'Unknown error occurred'}\`\`\``,
                        },
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: '🤖 *CodeAutopsy AI Agent*',
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

/**
 * Build generic message
 */
function buildGenericMessage(data, color) {
    return {
        attachments: [
            {
                color,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: data.message || 'Notification from CodeAutopsy',
                        },
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: '🤖 *CodeAutopsy AI Agent*',
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

/**
 * Send a simple text notification to Slack
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean}>}
 */
export async function sendSimpleSlackNotification(message) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
        return { success: false, reason: 'No webhook URL' };
    }

    try {
        await axios.post(webhookUrl, { text: message });
        return { success: true };
    } catch (error) {
        logger.error('Failed to send simple Slack notification', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Send startup notification to Slack
 */
export async function sendStartupNotification() {
    return sendSlackNotification({
        message: '🚀 CodeAutopsy is now online and monitoring for build failures!',
    }, 'info');
}

export default {
    sendSlackNotification,
    sendSimpleSlackNotification,
    sendStartupNotification,
};

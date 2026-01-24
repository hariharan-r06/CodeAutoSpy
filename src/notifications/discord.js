/**
 * Discord Notification Service
 * Sends rich embeds to Discord webhooks
 */

import axios from 'axios';
import logger from '../utils/logger.js';

// Notification types and their colors
export const NotificationType = {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info',
};

const COLORS = {
    success: 0x00ff00, // Green
    error: 0xff0000,   // Red
    warning: 0xffaa00, // Orange
    info: 0x0099ff,   // Blue
};

const EMOJIS = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
};

/**
 * Send a notification to Discord webhook
 * @param {object} data - Notification data
 * @param {string} type - Notification type
 * @returns {Promise<{success: boolean}>}
 */
export async function sendDiscordNotification(data, type = NotificationType.SUCCESS) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
        logger.debug('Discord webhook URL not configured, skipping notification');
        return { success: false, reason: 'No webhook URL' };
    }

    try {
        const embed = buildEmbed(data, type);

        await axios.post(webhookUrl, {
            embeds: [embed],
            username: 'CodeAutopsy',
            avatar_url: 'https://raw.githubusercontent.com/github/explore/main/topics/robot/robot.png',
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });

        logger.info('Discord notification sent', { type, eventId: data.eventId });
        return { success: true };
    } catch (error) {
        logger.error('Failed to send Discord notification', {
            error: error.message,
            status: error.response?.status,
        });
        return { success: false, error: error.message };
    }
}

/**
 * Build Discord embed object
 * @param {object} data - Notification data
 * @param {string} type - Notification type
 * @returns {object} Discord embed
 */
function buildEmbed(data, type) {
    const color = COLORS[type] || COLORS.info;
    const emoji = EMOJIS[type] || EMOJIS.info;

    // Handle error/failure notifications
    if (data.isFailure) {
        return buildErrorEmbed(data, color);
    }

    // Handle success notifications (PR or Issue created)
    if (data.prUrl) {
        return buildPREmbed(data, color, emoji);
    }

    if (data.issueUrl) {
        return buildIssueEmbed(data, color);
    }

    // Generic notification
    return buildGenericEmbed(data, color, emoji);
}

/**
 * Build embed for successful PR creation
 */
function buildPREmbed(data, color, emoji) {
    const fields = [
        {
            name: '📦 Repository',
            value: data.repoFullName,
            inline: true,
        },
        {
            name: '🌿 Branch',
            value: data.branch || 'main',
            inline: true,
        },
        {
            name: '🔴 Error Type',
            value: data.errorType || 'Unknown',
            inline: true,
        },
        {
            name: '📄 File Fixed',
            value: `\`${data.filePath}\``,
            inline: false,
        },
    ];

    if (data.confidence) {
        fields.push({
            name: '📊 Confidence',
            value: `${(data.confidence * 100).toFixed(0)}%`,
            inline: true,
        });
    }

    fields.push({
        name: '🔗 Pull Request',
        value: `[View PR #${data.prNumber}](${data.prUrl})`,
        inline: false,
    });

    return {
        title: `${emoji} CodeAutopsy: Fix Deployed`,
        color,
        fields,
        timestamp: new Date().toISOString(),
        footer: {
            text: 'CodeAutopsy AI Agent',
            icon_url: 'https://raw.githubusercontent.com/github/explore/main/topics/robot/robot.png',
        },
    };
}

/**
 * Build embed for issue creation (manual review needed)
 */
function buildIssueEmbed(data, color) {
    return {
        title: '⚠️ CodeAutopsy: Manual Review Required',
        description: 'A build failure was detected but requires manual review.',
        color: COLORS.warning,
        fields: [
            {
                name: '📦 Repository',
                value: data.repoFullName,
                inline: true,
            },
            {
                name: '🌿 Branch',
                value: data.branch || 'main',
                inline: true,
            },
            {
                name: '🔴 Error Type',
                value: data.errorType || 'Unknown',
                inline: true,
            },
            {
                name: '📄 File',
                value: `\`${data.filePath}\``,
                inline: false,
            },
            {
                name: '📊 Confidence',
                value: `${(data.confidence * 100).toFixed(0)}% (below threshold)`,
                inline: true,
            },
            {
                name: '🔗 Issue',
                value: `[View Issue #${data.issueNumber}](${data.issueUrl})`,
                inline: false,
            },
        ],
        timestamp: new Date().toISOString(),
        footer: {
            text: 'CodeAutopsy AI Agent',
        },
    };
}

/**
 * Build embed for processing errors
 */
function buildErrorEmbed(data, color) {
    return {
        title: '❌ CodeAutopsy: Processing Failed',
        description: 'Failed to automatically fix the build failure.',
        color: COLORS.error,
        fields: [
            {
                name: '📦 Repository',
                value: data.repoFullName,
                inline: true,
            },
            {
                name: '🌿 Branch',
                value: data.branch || 'unknown',
                inline: true,
            },
            {
                name: '❌ Error',
                value: data.error || 'Unknown error occurred',
                inline: false,
            },
        ],
        timestamp: new Date().toISOString(),
        footer: {
            text: 'CodeAutopsy AI Agent',
        },
    };
}

/**
 * Build generic embed
 */
function buildGenericEmbed(data, color, emoji) {
    return {
        title: `${emoji} CodeAutopsy Notification`,
        description: data.message || 'Notification from CodeAutopsy',
        color,
        timestamp: new Date().toISOString(),
        footer: {
            text: 'CodeAutopsy AI Agent',
        },
    };
}

/**
 * Send a simple text notification
 * @param {string} message - Message to send
 * @returns {Promise<{success: boolean}>}
 */
export async function sendSimpleNotification(message) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
        return { success: false, reason: 'No webhook URL' };
    }

    try {
        await axios.post(webhookUrl, {
            content: message,
            username: 'CodeAutopsy',
        });
        return { success: true };
    } catch (error) {
        logger.error('Failed to send simple Discord notification', { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * Send startup notification
 */
export async function sendStartupNotification() {
    return sendDiscordNotification({
        message: '🚀 CodeAutopsy is now online and monitoring for build failures!',
    }, NotificationType.INFO);
}

/**
 * Send shutdown notification
 */
export async function sendShutdownNotification() {
    return sendSimpleNotification('👋 CodeAutopsy is shutting down...');
}

export default {
    sendDiscordNotification,
    sendSimpleNotification,
    sendStartupNotification,
    sendShutdownNotification,
    NotificationType,
};

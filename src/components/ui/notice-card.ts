import './notice-card.css';

export interface NoticeCardProps {
    type: 'warning' | 'info' | 'success';
    message: string;
}

export function renderNoticeCard({ type, message }: NoticeCardProps): string {
    const icons = {
        warning: '⚠️',
        info: 'ℹ️',
        success: '✅'
    };

    return `
        <div class="notice-card notice-card-${type}">
            <span class="notice-icon">${icons[type]}</span>
            <p class="notice-message">${message}</p>
        </div>
    `;
} 
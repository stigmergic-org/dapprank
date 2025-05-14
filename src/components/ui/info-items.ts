interface ItemDetail {
    title: string;
    content: string;
}

interface InfoItem {
    icon: string;
    title: string;
    detected?: string;
    details?: ItemDetail[];
}

export function renderInfoItems(items: InfoItem[]): string {
    if (!items || items.length === 0) return '';

    return `
        <div class="info-items-list">
            ${items.map(item => `
                <div class="info-item">
                    <div class="info-item-type">
                        <span class="item-icon">${item.icon}</span>
                        ${item.title}
                        ${item.detected ? `
                            <span class="${item.detected.toLowerCase().includes('detected') ? 'item-detected' : 'item-not-detected'}">
                                ${item.detected}
                            </span>
                        ` : ''}
                    </div>
                    ${item.details ? `
                        <div class="info-item-details">
                            ${item.details.map(detail => `
                                <div class="detail-section">
                                    ${detail.title ? `<strong>${detail.title}</strong>` : ''}
                                    <div class="detail-content">
                                        ${detail.content}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
} 
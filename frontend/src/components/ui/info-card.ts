import './info-card.css';

export interface InfoCardProps {
    title: string;
    content: string;
    description?: string;
}

export function renderInfoCard({ title, content, description }: InfoCardProps): string {
    return `
        <div class="info-card">
            <div class="info-card-header">
                <h4>${title}</h4>
                ${description ? `<p class="info-card-description">${description}</p>` : ''}
            </div>
            <div class="info-card-content">
                ${content}
            </div>
        </div>
    `;
}
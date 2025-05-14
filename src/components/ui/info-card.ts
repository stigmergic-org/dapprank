import './info-card.css';

export interface InfoCardProps {
    title: string;
    content: string;
}

export function renderInfoCard({ title, content }: InfoCardProps): string {
    return `
        <div class="info-card">
            <div class="info-card-header">
                <h4>${title}</h4>
            </div>
            <div class="info-card-content">
                ${content}
            </div>
        </div>
    `;
}
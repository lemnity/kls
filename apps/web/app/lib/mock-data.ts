export interface Production {
  id: string;
  title: string;
  status: string;
  premiereDate: string | null;
  producerMembershipId: string | null;
  healthStatus: string;
  healthReason: string | null;
}

export interface BudgetItem {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
}

export interface BudgetSection {
  id: string;
  workshopId: string;
  title: string;
  items: BudgetItem[];
  subtotal: string;
}

export interface Budget {
  id: string;
  productionId: string;
  status: 'PRELIMINARY' | 'DETAILED' | 'APPROVED';
  versionId: string;
  revision: number;
  sections: BudgetSection[];
  total: string;
}

export const MOCK_PRODUCTIONS: Production[] = [
  {
    id: 'prod-1',
    title: 'Ревизор',
    status: 'in_progress',
    premiereDate: '2026-12-01',
    producerMembershipId: null,
    healthStatus: 'neutral',
    healthReason: null,
  },
  {
    id: 'prod-2',
    title: 'Чайка',
    status: 'draft',
    premiereDate: null,
    producerMembershipId: null,
    healthStatus: 'neutral',
    healthReason: null,
  },
];

export const MOCK_BUDGETS: Record<string, Budget> = {
  'prod-1': {
    id: 'budget-prod-1',
    productionId: 'prod-1',
    status: 'PRELIMINARY',
    versionId: 'version-prod-1',
    revision: 1,
    sections: [
      {
        id: 'section-1',
        workshopId: 'workshop-1',
        title: 'Пошивочный цех',
        subtotal: '6135.00',
        items: [
          { id: 'item-1', description: 'Ткань бархат', quantity: '12.500', unit: 'м', unitPrice: '450.00', total: '5625.00' },
          { id: 'item-2', description: 'Молнии', quantity: '6.000', unit: 'шт', unitPrice: '85.00', total: '510.00' },
        ],
      },
    ],
    total: '6135.00',
  },
};

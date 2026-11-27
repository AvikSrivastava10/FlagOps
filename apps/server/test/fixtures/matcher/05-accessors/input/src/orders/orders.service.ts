import { FeatureService } from '../flags/feature.service';

export class OrdersService {
  constructor(private readonly features: FeatureService) {}

  async place(): Promise<string> {
    if (await this.features.isOn('fraud_check_v2')) {
      return 'checked';
    }
    const local = new FeatureService();
    return (await local.isOn('promo_banner')) ? 'promoted' : 'plain';
  }
}

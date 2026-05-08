import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const s = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkDups() {
  const addresses = [
    '589 Hoàng Diệu, Hòa Cường, Đà Nẵng 550000, Vietnam',
    '86 Duy Tân, Hòa Cường, Đà Nẵng 550000, Vietnam'
  ];

  const { data, error } = await s.from('courts')
    .select('name, address, place_id')
    .in('address', addresses);

  if (error) {
    console.error(error);
    return;
  }

  console.log(data);
}

checkDups();

/**
 * China / HK universities aligned to User_Majors_for_Email_Subject.txt research areas.
 */
import { loadUserMajorsFromFile } from './userMajorsFile.js';
import { buildUniversityEntry } from './universityStrengths.js';

const CHINA_SEED_NAMES = [
  'Tsinghua University', 'Peking University', 'Zhejiang University', 'Shanghai Jiao Tong University',
  'Fudan University', 'University of Science and Technology of China', 'Nanjing University',
  'Harbin Institute of Technology', 'Beihang University', "Xi'an Jiaotong University", 'Wuhan University',
  'Sichuan University', 'Tongji University', 'Nankai University', 'Sun Yat-sen University',
  'Shanghai University', 'East China Normal University', 'Southeast University', 'Dalian University of Technology',
  'Tianjin University', 'Xiamen University', 'Renmin University of China', 'Shandong University',
  'Jilin University', 'Central South University', 'Hunan University', 'South China University of Technology',
  'Beijing Institute of Technology', 'University of Electronic Science and Technology of China',
  'Beijing Normal University', 'China Agricultural University', 'Northwestern Polytechnical University',
  'Chongqing University', 'Lanzhou University', 'Ocean University of China', 'China University of Petroleum',
  'Beijing Jiaotong University', 'Beijing University of Posts and Telecommunications',
  'Southwest Jiaotong University', 'Southwest University', 'Yunnan University', 'Guangxi University',
  'Guizhou University', 'Hohai University', 'Northeastern University China', 'Northeast University',
  'Qingdao University', 'Soochow University', 'Shenzhen University', 'Southern University of Science and Technology',
  'Westlake University', 'ShanghaiTech University', 'University of Chinese Academy of Sciences',
  'Chinese Academy of Sciences', 'Institute of Automation CAS', 'Institute of Computing Technology CAS',
  'HKUST', 'Chinese University of Hong Kong', 'University of Hong Kong', 'City University of Hong Kong',
  'Hong Kong Polytechnic University', 'Hong Kong Baptist University', 'Hong Kong Metropolitan University',
  'Macau University of Science and Technology', 'University of Macau',
  'National Taiwan University', 'National Tsing Hua University', 'National Chiao Tung University',
  'National Cheng Kung University', 'National Taiwan University of Science and Technology',
];

const CHINA_PROVINCE_GROUPS = {
  Beijing: [
    'Peking University', 'Tsinghua University', 'Beijing Normal University', 'Beijing Institute of Technology',
    'University of Chinese Academy of Sciences', 'University of Chinese Academy of Sciences (UCAS)',
    'Beihang University', 'Beihang University (former BUAA)', 'University of Science and Technology Beijing',
    'China Agricultural University', 'Renmin University of China', 'Renmin (People’s) University of China',
    'Beijing University of Chemical Technology', 'Beijing University of Technology', 'Beijing Jiaotong University',
    'Beijing University of Posts and Telecommunications', 'Beijing Foreign Studies University',
    'Beijing University of Chinese Medicine', 'China University of Political Science and Law',
    'University of International Business and Economics', 'Chinese Academy of Sciences',
    'Institute of Automation CAS', 'Institute of Computing Technology CAS',
  ],
  Shanghai: [
    'Fudan University', 'Shanghai Jiao Tong University', 'Tongji University', 'East China Normal University',
    'Shanghai University', 'East China University of Science and Technology', 'Donghua University',
    'Shanghai International Studies University', 'Shanghai University of Finance and Economics',
    'Shanghai Normal University', 'ShanghaiTech University',
  ],
  Zhejiang: ['Zhejiang University', 'Westlake University'],
  Jiangsu: [
    'Nanjing University', 'Southeast University', 'Southeast University, China', 'Soochow University',
    'China University of Mining and Technology', 'Nanjing University of Aeronautics and Astronautics',
    'Nanjing University of Science and Technology', 'Jiangnan University', 'Nanjing Agricultural University',
    'Nanjing Normal University', "Xi'an Jiaotong-Liverpool University", 'Hohai University',
  ],
  Anhui: ['University of Science and Technology of China'],
  Hubei: [
    'Wuhan University', 'Huazhong University of Science and Technology', 'China University of Geosciences',
    'Huazhong Agricultural University', 'Wuhan University of Technology',
  ],
  Guangdong: [
    'Sun Yat-sen University', 'Southern University of Science and Technology',
    'Southern University of Science and Technology (SUSTech)', 'South China University of Technology',
    'Shenzhen University', 'Jinan University (China)',
  ],
  Shaanxi: [
    "Xi'an Jiaotong University", 'Northwestern Polytechnical University',
    'Northwest Agriculture and Forestry University', 'Northwest University (China)',
  ],
  Sichuan: ['Sichuan University', 'University of Electronic Science and Technology of China', 'Southwest Jiaotong University'],
  Shandong: ['Shandong University', 'Ocean University of China', 'China University of Petroleum', 'Qingdao University'],
  Fujian: ['Xiamen University'],
  Tianjin: ['Tianjin University', 'Nankai University'],
  Heilongjiang: ['Harbin Institute of Technology', 'Harbin Engineering University'],
  Jilin: ['Jilin University'],
  Liaoning: ['Dalian University of Technology', 'Northeastern University China', 'Northeast University'],
  Hunan: ['Central South University', 'Hunan University'],
  Chongqing: ['Chongqing University', 'Southwest University'],
  Henan: ['Zhengzhou University'],
  Gansu: ['Lanzhou University'],
  Yunnan: ['Yunnan University'],
  Guangxi: ['Guangxi University'],
  Guizhou: ['Guizhou University'],
};

const CHINA_PROVINCE_BY_NAME = new Map(
  Object.entries(CHINA_PROVINCE_GROUPS)
    .flatMap(([province, names]) => names.map(name => [name.toLowerCase(), province]))
);

export function getChinaProvince(university) {
  return CHINA_PROVINCE_BY_NAME.get(String(university || '').trim().toLowerCase()) || 'Unknown';
}

let cached = null;

export function getChinaTargetUniversities() {
  if (cached) return cached;
  const majors = loadUserMajorsFromFile();
  cached = CHINA_SEED_NAMES.map(name => ({
    ...buildUniversityEntry(name, majors),
    province: getChinaProvince(name),
  }));
  return cached;
}

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

let cached = null;

export function getChinaTargetUniversities() {
  if (cached) return cached;
  const majors = loadUserMajorsFromFile();
  cached = CHINA_SEED_NAMES.map(name => buildUniversityEntry(name, majors));
  return cached;
}

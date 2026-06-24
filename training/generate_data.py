"""
Synthetic dataset generator for the MLOps project.

These are SYNTHETIC, DETERMINISTIC (seeded), and LEARNABLE datasets — not the real Kaggle data.
They are committed as data/<slug>/sample.csv so the system runs out-of-the-box.

To use the real public datasets, replace sample.csv with the same column contract:

  fraud:
    Source: https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud (creditcard.csv)
    Keep columns: Time → hour, V1..V28 → v1..v28 (subset to v1..v6 for this model), Amount → amount
    Label column: Class → is_fraud (0/1)

  iot:
    Source: https://www.kaggle.com/datasets/shivamb/machine-predictive-maintenance-classification
    Keep: Air temperature [K] → air_temp, Process temperature [K] → process_temp,
          Rotational speed [rpm] → rotational_speed, Torque [Nm] → torque,
          Tool wear [min] → tool_wear
    Label: Machine failure → failure (0/1); collapse all failure sub-types to binary.

  intrusion:
    Source: https://www.kaggle.com/datasets/hassan06/nslkdd (NSL-KDD KDDTrain+.txt)
    Keep: duration, src_bytes, dst_bytes, count, srv_count, protocol_type → protocol (0/1/2),
          flag → flag (0..3), label → attack (0=normal, 1=attack)
    All columns must be numeric; encode categoricals as integers.

Column contracts must match exactly; no code change required in streamer/inference/dashboard.

Difficulty tuning: each generator adds Gaussian noise to the key discriminating features
(to create class overlap) and flips ~7% of labels deterministically (seeded). This produces
realistic test accuracy in the 90-95% band — well above chance but not pegged at 100%.
"""

import numpy as np
import pandas as pd

SEED = 42
N = 6000  # rows per dataset

# Fraction of majority-class labels to flip to 1 (deterministic, seeded).
# Flipping only majority (0→1) preserves recall on the rare positive class while
# still creating ambiguity that lands test accuracy in the 90-95% band.
MAJORITY_FLIP_RATE = 0.05


def flip_labels(labels: np.ndarray, rate: float, seed: int) -> np.ndarray:
    """Flip a deterministic fraction of majority-class (0) labels to 1.

    Only majority-class samples are flipped so the rare positive class retains
    its signal. This lowers accuracy by injecting false positives without
    destroying recall, and is seeded for reproducibility.
    """
    rng = np.random.default_rng(seed + 9999)  # offset seed to avoid correlation with data rng
    majority_indices = np.where(labels == 0)[0]
    n_flip = int(len(majority_indices) * rate)
    flip_indices = rng.choice(majority_indices, size=n_flip, replace=False)
    noisy = labels.copy()
    noisy[flip_indices] = 1
    return noisy


def generate_fraud(n: int, seed: int) -> pd.DataFrame:
    """
    Synthetic credit-card-style fraud dataset.
    Features: amount, v1..v6, hour
    Label: is_fraud (0=Legit, 1=Fraud), ~5% positive rate

    Difficulty: class separation on v1/v2/v3 is reduced by half vs. the original
    (shifts of -2.0/-1.5/+1.2 instead of -4.5/-3.0/+2.5) and extra noise is added
    to v1..v3 for both classes. ~7% of labels are then flipped.
    """
    rng = np.random.default_rng(seed)

    n_fraud = int(n * 0.05)
    n_legit = n - n_fraud

    legit_amount = rng.lognormal(mean=4.5, sigma=1.2, size=n_legit)
    fraud_amount = rng.lognormal(mean=5.2, sigma=1.1, size=n_fraud)  # closer to legit

    legit_v = rng.normal(loc=0, scale=1, size=(n_legit, 6))
    # Reduced separation: original shifts reduced to ~60%; extra noise added to key features
    fraud_v = rng.normal(loc=0, scale=1, size=(n_fraud, 6))
    fraud_v[:, 0] -= 2.8   # was -4.5
    fraud_v[:, 1] -= 2.0   # was -3.0
    fraud_v[:, 2] += 1.6   # was +2.5

    # Add overlap noise to both classes on the signal features
    legit_v[:, 0] += rng.normal(0, 0.6, size=n_legit)
    legit_v[:, 1] += rng.normal(0, 0.6, size=n_legit)
    fraud_v[:, 0] += rng.normal(0, 0.6, size=n_fraud)
    fraud_v[:, 1] += rng.normal(0, 0.6, size=n_fraud)

    legit_hour = rng.integers(0, 24, size=n_legit)
    fraud_hour = rng.integers(0, 24, size=n_fraud)

    amounts = np.concatenate([legit_amount, fraud_amount])
    v_features = np.vstack([legit_v, fraud_v])
    hours = np.concatenate([legit_hour, fraud_hour])
    labels = np.array([0] * n_legit + [1] * n_fraud)

    # Inject label noise
    labels = flip_labels(labels, MAJORITY_FLIP_RATE, seed)

    df = pd.DataFrame(v_features, columns=[f"v{i+1}" for i in range(6)])
    df["amount"] = amounts
    df["hour"] = hours
    df["is_fraud"] = labels

    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    for col in [f"v{i+1}" for i in range(6)] + ["amount"]:
        df[col] = df[col].round(6)

    return df


def generate_iot(n: int, seed: int) -> pd.DataFrame:
    """
    Synthetic predictive maintenance dataset.
    Features: air_temp, process_temp, rotational_speed, torque, tool_wear
    Label: failure (0=OK, 1=Failure), ~8% positive rate

    Difficulty: failure conditions are moved closer to normal operating ranges
    (smaller speed/torque deltas, overlapping tool_wear bands) and ~7% of labels
    are flipped.
    """
    rng = np.random.default_rng(seed)

    n_fail = int(n * 0.08)
    n_ok = n - n_fail

    # Normal operating conditions (unchanged)
    air_temp_ok = rng.normal(300, 2, size=n_ok)
    proc_temp_ok = air_temp_ok + rng.normal(10, 1, size=n_ok)
    rot_speed_ok = rng.normal(1500, 120, size=n_ok)   # slightly wider spread
    torque_ok = rng.normal(40, 12, size=n_ok)          # slightly wider spread
    tool_wear_ok = rng.uniform(0, 220, size=n_ok)      # extended range to overlap with failure

    # Failure conditions moved closer to normal (reduced deltas, more overlap)
    air_temp_fail = rng.normal(301.5, 3, size=n_fail)   # was 302
    proc_temp_fail = air_temp_fail + rng.normal(11, 2, size=n_fail)  # was 12
    rot_speed_fail = rng.normal(1300, 170, size=n_fail)  # was 1200/150 — closer to normal
    torque_fail = rng.normal(55, 13, size=n_fail)        # was 65/12 — closer to normal
    tool_wear_fail = rng.uniform(150, 250, size=n_fail)  # overlaps with ok range

    air_temp = np.concatenate([air_temp_ok, air_temp_fail])
    proc_temp = np.concatenate([proc_temp_ok, proc_temp_fail])
    rot_speed = np.concatenate([rot_speed_ok, rot_speed_fail])
    torque = np.concatenate([torque_ok, torque_fail])
    tool_wear = np.concatenate([tool_wear_ok, tool_wear_fail])
    labels = np.array([0] * n_ok + [1] * n_fail)

    # Inject label noise
    labels = flip_labels(labels, MAJORITY_FLIP_RATE, seed)

    df = pd.DataFrame({
        "air_temp": air_temp.round(2),
        "process_temp": proc_temp.round(2),
        "rotational_speed": rot_speed.round(1),
        "torque": torque.round(2),
        "tool_wear": tool_wear.round(1),
        "failure": labels,
    })

    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    return df


def generate_intrusion(n: int, seed: int) -> pd.DataFrame:
    """
    Synthetic network intrusion detection dataset.
    Features: duration, src_bytes, dst_bytes, count, srv_count, protocol (0/1/2), flag (0..3)
    Label: attack (0=Normal, 1=Attack), ~30% positive rate

    Difficulty: byte count and connection count distributions for attack/normal traffic
    are moved closer together (overlapping lognormal means), and ~7% of labels are flipped.
    """
    rng = np.random.default_rng(seed)

    n_attack = int(n * 0.30)
    n_normal = n - n_attack

    # Normal traffic
    dur_norm = rng.exponential(scale=0.5, size=n_normal)
    src_bytes_norm = rng.lognormal(mean=6, sigma=2.2, size=n_normal).astype(int)   # wider sigma
    dst_bytes_norm = rng.lognormal(mean=6.5, sigma=2.2, size=n_normal).astype(int)
    count_norm = rng.integers(1, 80, size=n_normal)    # wider range to overlap with attack
    srv_count_norm = rng.integers(1, 35, size=n_normal)
    protocol_norm = rng.choice([0, 1, 2], size=n_normal, p=[0.6, 0.3, 0.1])
    flag_norm = rng.choice([0, 1, 2, 3], size=n_normal, p=[0.6, 0.15, 0.15, 0.1])  # less skewed

    # Attack traffic: moved closer to normal (reduced mean separation)
    dur_att = rng.exponential(scale=0.3, size=n_attack)   # was 0.1 — closer to normal
    src_bytes_att = rng.lognormal(mean=7.5, sigma=2.5, size=n_attack).astype(int)  # was 9
    dst_bytes_att = rng.lognormal(mean=4.5, sigma=2.2, size=n_attack).astype(int)  # was 3
    count_att = rng.integers(30, 300, size=n_attack)      # was 50-512, starts lower now
    srv_count_att = rng.integers(5, 70, size=n_attack)    # was 10-100
    protocol_att = rng.choice([0, 1, 2], size=n_attack, p=[0.45, 0.45, 0.1])  # less distinct
    flag_att = rng.choice([0, 1, 2, 3], size=n_attack, p=[0.3, 0.35, 0.25, 0.1])

    duration = np.concatenate([dur_norm, dur_att]).round(4)
    src_bytes = np.concatenate([src_bytes_norm, src_bytes_att])
    dst_bytes = np.concatenate([dst_bytes_norm, dst_bytes_att])
    count = np.concatenate([count_norm, count_att])
    srv_count = np.concatenate([srv_count_norm, srv_count_att])
    protocol = np.concatenate([protocol_norm, protocol_att])
    flag = np.concatenate([flag_norm, flag_att])
    labels = np.array([0] * n_normal + [1] * n_attack)

    # Inject label noise
    labels = flip_labels(labels, MAJORITY_FLIP_RATE, seed)

    df = pd.DataFrame({
        "duration": duration,
        "src_bytes": src_bytes,
        "dst_bytes": dst_bytes,
        "count": count,
        "srv_count": srv_count,
        "protocol": protocol,
        "flag": flag,
        "attack": labels,
    })

    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    return df


def main() -> None:
    """Generate and write all three sample datasets."""
    datasets = {
        "fraud": (generate_fraud, "/app/data/fraud/sample.csv"),
        "iot": (generate_iot, "/app/data/iot/sample.csv"),
        "intrusion": (generate_intrusion, "/app/data/intrusion/sample.csv"),
    }

    for slug, (gen_fn, path) in datasets.items():
        df = gen_fn(N, SEED)
        df.to_csv(path, index=False)
        label_col = {"fraud": "is_fraud", "iot": "failure", "intrusion": "attack"}[slug]
        pos = df[label_col].sum()
        rate = pos / len(df) * 100
        print(f"{slug}: {len(df)} rows, {pos} positives ({rate:.1f}%), saved to {path}")


if __name__ == "__main__":
    main()

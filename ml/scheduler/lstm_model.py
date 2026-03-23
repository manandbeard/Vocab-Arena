"""
LSTM model for predicting recall probability.

Architecture
------------
  Input  : (batch, seq_len, INPUT_SIZE)
  LSTM   : hidden_size=64, num_layers=2, dropout=0.2
  Linear : 64 → 1
  Sigmoid: → p(recall)
"""
import torch
import torch.nn as nn
from .features import INPUT_SIZE

HIDDEN_SIZE = 64
NUM_LAYERS = 2
DROPOUT = 0.2


class RecallLSTM(nn.Module):
    def __init__(
        self,
        input_size: int = INPUT_SIZE,
        hidden_size: int = HIDDEN_SIZE,
        num_layers: int = NUM_LAYERS,
        dropout: float = DROPOUT,
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.head = nn.Linear(hidden_size, 1)

    def forward(
        self,
        x: torch.Tensor,
        hc: tuple[torch.Tensor, torch.Tensor] | None = None,
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        """
        Parameters
        ----------
        x   : (batch, seq_len, input_size)
        hc  : optional initial (h, c) state

        Returns
        -------
        probs : (batch, seq_len, 1)  – sigmoid probabilities
        (h, c): final hidden state
        """
        out, (h, c) = self.lstm(x, hc)
        probs = torch.sigmoid(self.head(out))
        return probs, (h, c)

    def predict_last(
        self,
        x: torch.Tensor,
        hc: tuple[torch.Tensor, torch.Tensor] | None = None,
    ) -> tuple[torch.Tensor, tuple[torch.Tensor, torch.Tensor]]:
        """Return the probability for only the last timestep."""
        probs, (h, c) = self.forward(x, hc)
        return probs[:, -1, :], (h, c)
